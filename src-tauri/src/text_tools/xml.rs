use quick_xml::{
    NsReader, XmlVersion,
    errors::{Error, IllFormedError},
    escape::EscapeError,
    events::{BytesRef, BytesStart, Event},
    name::ResolveResult,
};
use serde::{Deserialize, Serialize};

pub const MAX_INPUT_BYTES: usize = 1024 * 1024;
pub const MAX_DEPTH: usize = 256;
pub const MAX_OUTPUT_BYTES: usize = 8 * 1024 * 1024;

const XINCLUDE_NAMESPACE: &str = "http://www.w3.org/2001/XInclude";
const DOCTYPE_REASON: &str = "不支持 DTD（DOCTYPE），已拒绝；未读取任何外部资源。";
const XINCLUDE_REASON: &str = "不支持 XInclude，已拒绝；未读取任何外部资源。";
const CUSTOM_ENTITY_REASON: &str = "未声明的实体引用（已禁用 DTD，不展开自定义实体）。";
const CHAR_REF_REASON: &str = "无效的字符引用，或实体引用不是预定义实体。";
const DEPTH_REASON: &str = "嵌套深度超过 256 层上限。";
const DECLARATION_POSITION_REASON: &str = "XML 声明必须位于文档开头。";
const DECLARATION_VERSION_REASON: &str = "仅支持 XML 1.0 声明。";
const DECLARATION_ENCODING_REASON: &str =
    "声明的编码不是 UTF-8；输入已按 UTF-8 读取，无法按声明重新解码，已拒绝。";
const BOM_REASON: &str = "输入以 UTF-8 BOM 开头，请先去除。";
const XML_SPACE_REASON: &str = "xml:space 只能为 default 或 preserve。";
const ATTRIBUTE_REASON: &str = "属性语法错误、属性重复，或属性值含未转义的 <。";
const COMMENT_REASON: &str = "注释内不允许出现 --。";
const CDATA_END_REASON: &str = "文本内容中不允许出现 ]]>。";
const RESERVED_PI_REASON: &str = "处理指令名 xml 为保留名称。";
const MISMATCH_REASON: &str = "结束标签与开始标签不匹配。";
const UNCLOSED_REASON: &str = "元素未闭合。";
const UNMATCHED_END_REASON: &str = "多余的结束标签。";
const ONE_ROOT_REASON: &str = "文档只能有一个根元素。";
const OUTSIDE_ROOT_REASON: &str = "根元素之外不允许文本、CDATA 或实体引用。";
const NO_ROOT_REASON: &str = "缺少根元素。";
const EMPTY_REASON: &str = "输入为空。";
const ENCODING_REASON: &str = "输入编码无效。";
const NAMESPACE_REASON: &str = "命名空间前缀无效。";
const REFERENCE_REASON: &str = "实体引用未以分号结束，或含未转义的 &。";
const SYNTAX_REASON: &str = "XML 语法错误。";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum XmlFormatMode {
    Indent2,
    Indent4,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormattedXml {
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum XmlError {
    InputTooLarge,
    OutputTooLarge,
    /// `line` and `column` are 1-based; `column` counts characters.
    Invalid {
        line: usize,
        column: usize,
        reason: &'static str,
    },
}

/// Checks well-formedness and re-indents element-only content. Only whitespace
/// between element-only children changes; mixed content, `xml:space="preserve"`
/// subtrees and anything carrying text is copied from the source byte for byte.
/// DTDs, XInclude and entities other than the predefined ones are rejected and
/// never read or expanded.
pub fn format(text: &str, mode: XmlFormatMode) -> Result<FormattedXml, XmlError> {
    if text.len() > MAX_INPUT_BYTES {
        return Err(XmlError::InputTooLarge);
    }
    if text.starts_with('\u{feff}') {
        return Err(invalid(text, 0, BOM_REASON));
    }
    let document = Document::parse(text)?;
    let indent = match mode {
        XmlFormatMode::Indent2 => 2,
        XmlFormatMode::Indent4 => 4,
    };
    let mut output = Output::default();
    for &index in &document.top {
        if !output.text.is_empty() {
            output.push_str("\n")?;
        }
        document.emit(index, 0, indent, &mut output)?;
    }
    Ok(FormattedXml { text: output.text })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Element,
    Whitespace,
    /// Non-whitespace text, CDATA or a character/entity reference.
    Significant,
    /// Comment, processing instruction or declaration.
    Markup,
}

#[derive(Debug)]
struct Node {
    kind: Kind,
    start: usize,
    open_end: usize,
    close_start: usize,
    end: usize,
    children: Vec<usize>,
    has_element: bool,
    has_significant: bool,
    preserve: bool,
}

impl Node {
    fn leaf(kind: Kind, start: usize, end: usize) -> Self {
        Self {
            kind,
            start,
            open_end: end,
            close_start: end,
            end,
            children: Vec::new(),
            has_element: false,
            has_significant: false,
            preserve: false,
        }
    }

    fn element(start: usize, end: usize, preserve: bool) -> Self {
        Self {
            kind: Kind::Element,
            preserve,
            ..Self::leaf(Kind::Element, start, end)
        }
    }
}

struct Document<'a> {
    src: &'a str,
    nodes: Vec<Node>,
    top: Vec<usize>,
    stack: Vec<usize>,
    root_seen: bool,
}

impl<'a> Document<'a> {
    fn parse(src: &'a str) -> Result<Self, XmlError> {
        let mut document = Self {
            src,
            nodes: Vec::new(),
            top: Vec::new(),
            stack: Vec::new(),
            root_seen: false,
        };
        let mut reader = NsReader::from_str(src);
        reader.config_mut().check_comments = true;
        let mut start = 0;
        loop {
            let next = reader
                .read_resolved_event()
                .map(|(namespace, event)| (is_xinclude_namespace(&namespace), event));
            let (xinclude, event) = match next {
                Ok(pair) => pair,
                Err(error) => {
                    return Err(map_read_error(error, src, reader.error_position() as usize));
                }
            };
            let end = reader.buffer_position() as usize;
            match event {
                Event::Eof => break,
                Event::Start(element) => document.open(element, xinclude, start, end, false)?,
                Event::Empty(element) => document.open(element, xinclude, start, end, true)?,
                Event::End(_) => document.close(start, end)?,
                Event::Text(text) => {
                    let raw: &str = &text;
                    if raw.contains("]]>") {
                        return Err(invalid(src, start, CDATA_END_REASON));
                    }
                    let kind = if raw.chars().all(is_xml_whitespace) {
                        Kind::Whitespace
                    } else {
                        Kind::Significant
                    };
                    document.add_content(kind, start, end)?;
                }
                Event::CData(_) => document.add_content(Kind::Significant, start, end)?,
                Event::GeneralRef(reference) => {
                    check_reference(&reference, src, start)?;
                    document.add_content(Kind::Significant, start, end)?;
                }
                Event::Comment(_) => document.add_markup(start, end),
                Event::PI(instruction) => {
                    let raw: &str = &instruction;
                    let target = raw.split(is_xml_whitespace).next().unwrap_or_default();
                    if target.eq_ignore_ascii_case("xml") {
                        return Err(invalid(src, start, RESERVED_PI_REASON));
                    }
                    document.add_markup(start, end);
                }
                Event::Decl(declaration) => {
                    if start != 0 {
                        return Err(invalid(src, start, DECLARATION_POSITION_REASON));
                    }
                    check_declaration(&declaration, src, start)?;
                    document.add_markup(start, end);
                }
                Event::DocType(_) => return Err(invalid(src, start, DOCTYPE_REASON)),
            }
            start = end;
        }
        if let Some(&index) = document.stack.last() {
            return Err(invalid(src, document.nodes[index].start, UNCLOSED_REASON));
        }
        if !document.root_seen {
            let reason = if src.chars().all(is_xml_whitespace) {
                EMPTY_REASON
            } else {
                NO_ROOT_REASON
            };
            return Err(invalid(src, src.len(), reason));
        }
        Ok(document)
    }

    fn open(
        &mut self,
        element: BytesStart<'_>,
        xinclude: bool,
        start: usize,
        end: usize,
        empty: bool,
    ) -> Result<(), XmlError> {
        let name = element.name();
        if xinclude || matches!(name.as_ref(), "xi:include" | "xi:fallback") {
            return Err(invalid(self.src, start, XINCLUDE_REASON));
        }
        if self.stack.len() >= MAX_DEPTH {
            return Err(invalid(self.src, start, DEPTH_REASON));
        }
        if self.stack.is_empty() {
            if self.root_seen {
                return Err(invalid(self.src, start, ONE_ROOT_REASON));
            }
            self.root_seen = true;
        }
        let mut preserve = false;
        for attribute in element.attributes() {
            let attribute = attribute.map_err(|_| invalid(self.src, start, ATTRIBUTE_REASON))?;
            if attribute.value.contains('<') {
                return Err(invalid(self.src, start, ATTRIBUTE_REASON));
            }
            let value = attribute
                .normalized_value(XmlVersion::Explicit1_0)
                .map_err(|error| map_read_error(error, self.src, start))?;
            if attribute.key.as_ref() == "xml:space" {
                preserve = match value.as_ref() {
                    "preserve" => true,
                    "default" => false,
                    _ => return Err(invalid(self.src, start, XML_SPACE_REASON)),
                };
            }
        }
        let index = self.nodes.len();
        self.nodes.push(Node::element(start, end, preserve));
        self.attach(index, Kind::Element);
        if !empty {
            self.stack.push(index);
        }
        Ok(())
    }

    fn close(&mut self, start: usize, end: usize) -> Result<(), XmlError> {
        let index = self
            .stack
            .pop()
            .ok_or_else(|| invalid(self.src, start, UNMATCHED_END_REASON))?;
        let node = &mut self.nodes[index];
        node.close_start = start;
        node.end = end;
        Ok(())
    }

    fn add_content(&mut self, kind: Kind, start: usize, end: usize) -> Result<(), XmlError> {
        if self.stack.is_empty() {
            if kind == Kind::Significant {
                return Err(invalid(self.src, start, OUTSIDE_ROOT_REASON));
            }
            return Ok(());
        }
        let index = self.nodes.len();
        self.nodes.push(Node::leaf(kind, start, end));
        self.attach(index, kind);
        Ok(())
    }

    fn add_markup(&mut self, start: usize, end: usize) {
        let index = self.nodes.len();
        self.nodes.push(Node::leaf(Kind::Markup, start, end));
        self.attach(index, Kind::Markup);
    }

    fn attach(&mut self, index: usize, kind: Kind) {
        match self.stack.last().copied() {
            Some(parent) => {
                self.nodes[parent].children.push(index);
                match kind {
                    Kind::Element => self.nodes[parent].has_element = true,
                    Kind::Significant => self.nodes[parent].has_significant = true,
                    Kind::Whitespace | Kind::Markup => {}
                }
            }
            None => self.top.push(index),
        }
    }

    fn is_structural(&self, node: &Node) -> bool {
        node.kind == Kind::Element && node.has_element && !node.has_significant && !node.preserve
    }

    fn emit(
        &self,
        index: usize,
        depth: usize,
        indent: usize,
        output: &mut Output,
    ) -> Result<(), XmlError> {
        let node = &self.nodes[index];
        if !self.is_structural(node) {
            return output.push_str(&self.src[node.start..node.end]);
        }
        output.push_str(&self.src[node.start..node.open_end])?;
        for &child in &node.children {
            if self.nodes[child].kind == Kind::Whitespace {
                continue;
            }
            output.push_str("\n")?;
            output.push_spaces((depth + 1) * indent)?;
            self.emit(child, depth + 1, indent, output)?;
        }
        output.push_str("\n")?;
        output.push_spaces(depth * indent)?;
        output.push_str(&self.src[node.close_start..node.end])
    }
}

#[derive(Default)]
struct Output {
    text: String,
}

impl Output {
    fn push_str(&mut self, text: &str) -> Result<(), XmlError> {
        if self.text.len() + text.len() > MAX_OUTPUT_BYTES {
            return Err(XmlError::OutputTooLarge);
        }
        self.text.push_str(text);
        Ok(())
    }

    fn push_spaces(&mut self, count: usize) -> Result<(), XmlError> {
        if self.text.len() + count > MAX_OUTPUT_BYTES {
            return Err(XmlError::OutputTooLarge);
        }
        self.text.extend(std::iter::repeat_n(' ', count));
        Ok(())
    }
}

fn check_reference(reference: &BytesRef<'_>, src: &str, start: usize) -> Result<(), XmlError> {
    if reference.is_char_ref() {
        return match reference.resolve_char_ref() {
            Ok(Some(ch)) if is_xml_char(ch) => Ok(()),
            _ => Err(invalid(src, start, CHAR_REF_REASON)),
        };
    }
    let name: &str = reference;
    if matches!(name, "lt" | "gt" | "amp" | "apos" | "quot") {
        Ok(())
    } else {
        Err(invalid(src, start, CUSTOM_ENTITY_REASON))
    }
}

fn check_declaration(
    declaration: &quick_xml::events::BytesDecl<'_>,
    src: &str,
    start: usize,
) -> Result<(), XmlError> {
    match declaration.version() {
        Ok(version) if version == "1.0" => {}
        _ => return Err(invalid(src, start, DECLARATION_VERSION_REASON)),
    }
    if let Some(encoding) = declaration.encoding() {
        match encoding {
            Ok(label)
                if label.eq_ignore_ascii_case("utf-8") || label.eq_ignore_ascii_case("utf8") => {}
            _ => return Err(invalid(src, start, DECLARATION_ENCODING_REASON)),
        }
    }
    Ok(())
}

fn is_xinclude_namespace(namespace: &ResolveResult<'_>) -> bool {
    matches!(namespace, ResolveResult::Bound(bound) if bound.as_ref() == XINCLUDE_NAMESPACE)
}

fn map_read_error(error: Error, src: &str, offset: usize) -> XmlError {
    let reason = match error {
        Error::IllFormed(IllFormedError::MismatchedEndTag { .. }) => MISMATCH_REASON,
        Error::IllFormed(IllFormedError::UnmatchedEndTag(_)) => UNMATCHED_END_REASON,
        Error::IllFormed(IllFormedError::MissingEndTag(_)) => UNCLOSED_REASON,
        Error::IllFormed(IllFormedError::DoubleHyphenInComment) => COMMENT_REASON,
        Error::IllFormed(IllFormedError::UnclosedReference) => REFERENCE_REASON,
        Error::Escape(EscapeError::UnrecognizedEntity(..)) => CUSTOM_ENTITY_REASON,
        Error::Escape(_) => CHAR_REF_REASON,
        Error::InvalidAttr(_) => ATTRIBUTE_REASON,
        Error::Encoding(_) => ENCODING_REASON,
        Error::Namespace(_) => NAMESPACE_REASON,
        Error::Syntax(_) | Error::IllFormed(_) | Error::Io(_) => SYNTAX_REASON,
    };
    invalid(src, offset, reason)
}

fn invalid(src: &str, offset: usize, reason: &'static str) -> XmlError {
    let mut offset = offset.min(src.len());
    while !src.is_char_boundary(offset) {
        offset -= 1;
    }
    let before = &src[..offset];
    let line = before.matches('\n').count() + 1;
    let line_start = before.rfind('\n').map_or(0, |index| index + 1);
    let column = before[line_start..].chars().count() + 1;
    XmlError::Invalid {
        line,
        column,
        reason,
    }
}

fn is_xml_whitespace(ch: char) -> bool {
    matches!(ch, ' ' | '\t' | '\r' | '\n')
}

fn is_xml_char(ch: char) -> bool {
    matches!(
        ch,
        '\u{9}' | '\u{A}' | '\u{D}' | '\u{20}'..='\u{D7FF}' | '\u{E000}'..='\u{FFFD}' | '\u{10000}'..='\u{10FFFF}'
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn format_ok(text: &str, mode: XmlFormatMode) -> String {
        match format(text, mode) {
            Ok(result) => result.text,
            Err(error) => panic!("expected ok for {text:?}, got {error:?}"),
        }
    }

    fn indent2(text: &str) -> String {
        format_ok(text, XmlFormatMode::Indent2)
    }

    fn invalid(text: &str) -> (usize, usize, &'static str) {
        match format(text, XmlFormatMode::Indent2) {
            Err(XmlError::Invalid {
                line,
                column,
                reason,
            }) => (line, column, reason),
            other => panic!("expected invalid for {text:?}, got {other:?}"),
        }
    }

    #[test]
    fn limits_are_the_documented_values() {
        assert_eq!(MAX_INPUT_BYTES, 1_048_576);
        assert_eq!(MAX_DEPTH, 256);
        assert_eq!(MAX_OUTPUT_BYTES, 8 * 1024 * 1024);
    }

    #[test]
    fn indents_nested_elements_with_two_or_four_spaces() {
        assert_eq!(
            indent2("<a><b>x</b><c/></a>"),
            "<a>\n  <b>x</b>\n  <c/>\n</a>"
        );
        assert_eq!(
            format_ok("<a><b><c/></b></a>", XmlFormatMode::Indent4),
            "<a>\n    <b>\n        <c/>\n    </b>\n</a>"
        );
    }

    #[test]
    fn drops_whitespace_between_element_only_children_and_reindents() {
        assert_eq!(
            indent2("<a>\n\n      <b>\n</b>  </a>"),
            "<a>\n  <b>\n</b>\n</a>"
        );
    }

    #[test]
    fn keeps_declaration_namespaces_attributes_and_quotes_verbatim() {
        let input = r#"<?xml version="1.0" encoding="UTF-8"?><root xmlns:x="urn:x" b='2' a="1 &amp; &lt;"><x:c/></root>"#;
        assert_eq!(
            indent2(input),
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<root xmlns:x=\"urn:x\" b='2' a=\"1 &amp; &lt;\">\n  <x:c/>\n</root>"
        );
    }

    #[test]
    fn keeps_comments_and_processing_instructions_on_their_own_lines() {
        assert_eq!(
            indent2("<a><!-- c --><?pi data?><b/></a>"),
            "<a>\n  <!-- c -->\n  <?pi data?>\n  <b/>\n</a>"
        );
    }

    #[test]
    fn keeps_prolog_and_epilog_items_at_top_level() {
        assert_eq!(
            indent2("<!-- top --><?pi p?><root/><!-- end -->"),
            "<!-- top -->\n<?pi p?>\n<root/>\n<!-- end -->"
        );
    }

    #[test]
    fn keeps_cdata_sections_and_their_element_untouched() {
        assert_eq!(indent2("<a><![CDATA[ x ]]></a>"), "<a><![CDATA[ x ]]></a>");
        assert_eq!(
            indent2("<r>\n  <a><![CDATA[ x ]]></a>\n</r>"),
            "<r>\n  <a><![CDATA[ x ]]></a>\n</r>"
        );
    }

    #[test]
    fn keeps_mixed_content_subtree_verbatim_without_inserted_indentation() {
        assert_eq!(
            indent2("<root><p>Hello <b>big</b>   world</p></root>"),
            "<root>\n  <p>Hello <b>big</b>   world</p>\n</root>"
        );
    }

    #[test]
    fn element_only_children_of_a_mixed_free_parent_are_still_reindented() {
        assert_eq!(
            indent2("<root>\n<p>  <b> a </b>\n</p>\n</root>"),
            "<root>\n  <p>\n    <b> a </b>\n  </p>\n</root>"
        );
    }

    #[test]
    fn keeps_xml_space_preserve_subtree_verbatim() {
        assert_eq!(
            indent2("<root><pre xml:space=\"preserve\">\n  <a>  x  </a>\n</pre></root>"),
            "<root>\n  <pre xml:space=\"preserve\">\n  <a>  x  </a>\n</pre>\n</root>"
        );
    }

    #[test]
    fn rejects_unknown_xml_space_values() {
        let (line, column, reason) = invalid("<a xml:space=\"keep\"/>");
        assert_eq!((line, column), (1, 1));
        assert!(reason.contains("xml:space"), "{reason}");
    }

    #[test]
    fn keeps_predefined_and_numeric_references_verbatim() {
        assert_eq!(
            indent2("<a>&amp;&#x41;&#65;&lt;</a>"),
            "<a>&amp;&#x41;&#65;&lt;</a>"
        );
    }

    #[test]
    fn rejects_doctype_including_internal_subset_without_reading_anything() {
        let cases = [
            r#"<!DOCTYPE r SYSTEM "file:///userhome-missing/entities.dtd"><r/>"#,
            r#"<!DOCTYPE r [<!ENTITY e SYSTEM "file:///userhome-missing/secret">]><r>&e;</r>"#,
            r#"<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]><lolz>&lol2;</lolz>"#,
        ];
        for input in cases {
            let (_, _, reason) = invalid(input);
            assert!(reason.contains("DTD"), "{input}: {reason}");
        }
    }

    #[test]
    fn rejects_xinclude_with_declared_and_undeclared_prefix() {
        let declared = r#"<r xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="file:///userhome-missing/x"/></r>"#;
        let (_, _, reason) = invalid(declared);
        assert!(reason.contains("XInclude"), "{reason}");

        let undeclared = r#"<r><xi:include href="http://127.0.0.1:9/x"/></r>"#;
        let (_, _, reason) = invalid(undeclared);
        assert!(reason.contains("XInclude"), "{reason}");
    }

    #[test]
    fn rejects_custom_entity_references_in_text_and_attributes() {
        let (line, column, reason) = invalid("<r>&foo;</r>");
        assert_eq!((line, column), (1, 4));
        assert!(reason.contains("未声明的实体"), "{reason}");

        let (_, _, reason) = invalid(r#"<r a="&foo;"/>"#);
        assert!(reason.contains("未声明的实体"), "{reason}");
    }

    #[test]
    fn rejects_invalid_character_references() {
        for input in [
            "<r>&#0;</r>",
            "<r>&#xD800;</r>",
            "<r>&#xFFFE;</r>",
            "<r>&#x;</r>",
        ] {
            let (_, _, reason) = invalid(input);
            assert!(reason.contains("字符引用"), "{input}: {reason}");
        }
    }

    #[test]
    fn rejects_non_utf8_encoding_declarations_and_accepts_utf8_labels() {
        for input in [
            r#"<?xml version="1.0" encoding="ISO-8859-1"?><r/>"#,
            r#"<?xml version="1.0" encoding="UTF-16"?><r/>"#,
        ] {
            let (_, _, reason) = invalid(input);
            assert!(reason.contains("UTF-8"), "{input}: {reason}");
        }
        assert_eq!(
            indent2(r#"<?xml version="1.0" encoding="utf-8"?><r/>"#),
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<r/>"
        );
    }

    #[test]
    fn rejects_xml_declaration_not_at_document_start_and_bom() {
        let (_, _, reason) = invalid("  <?xml version=\"1.0\"?><r/>");
        assert!(reason.contains("XML 声明"), "{reason}");

        let (_, _, reason) = invalid("<a/><?xml version=\"1.0\"?>");
        assert!(reason.contains("XML 声明"), "{reason}");

        let (_, _, reason) = invalid("\u{feff}<r/>");
        assert!(reason.contains("BOM"), "{reason}");
    }

    #[test]
    fn reports_line_and_column_for_mismatched_end_tag() {
        let (line, _, reason) = invalid("<a>\n  <b>\n</a>");
        assert_eq!(line, 3);
        assert!(reason.contains("不匹配"), "{reason}");
    }

    #[test]
    fn reports_unclosed_element_at_end_of_input() {
        let (line, _, reason) = invalid("<a>\n<b>");
        assert_eq!(line, 2);
        assert!(reason.contains("未闭合"), "{reason}");
    }

    #[test]
    fn rejects_second_root_and_text_outside_root() {
        let (line, column, reason) = invalid("<a/><b/>");
        assert_eq!((line, column), (1, 5));
        assert!(reason.contains("一个根元素"), "{reason}");

        let (_, _, reason) = invalid("x<a/>");
        assert!(reason.contains("根元素之外"), "{reason}");
    }

    #[test]
    fn rejects_empty_input_and_missing_root() {
        for input in ["", "  \n ", "<!-- only -->"] {
            let (_, _, reason) = invalid(input);
            assert!(
                reason.contains("根元素") || reason.contains("为空"),
                "{input:?}: {reason}"
            );
        }
    }

    #[test]
    fn rejects_duplicate_unquoted_and_lt_containing_attributes() {
        let (_, _, reason) = invalid(r#"<a x="1" x="2"/>"#);
        assert!(reason.contains("属性"), "{reason}");

        let (_, _, reason) = invalid("<a x=1/>");
        assert!(reason.contains("属性"), "{reason}");

        let (_, _, reason) = invalid(r#"<a x="<"/>"#);
        assert!(reason.contains("属性"), "{reason}");
    }

    #[test]
    fn rejects_double_hyphen_in_comments_and_cdata_end_marker_in_text() {
        let (_, _, reason) = invalid("<a><!-- x -- y --></a>");
        assert!(reason.contains("注释"), "{reason}");

        let (_, _, reason) = invalid("<a>]]></a>");
        assert!(reason.contains("]]>"), "{reason}");
    }

    #[test]
    fn rejects_reserved_xml_processing_instruction_target() {
        let (_, _, reason) = invalid("<a><?XmL x?></a>");
        assert!(reason.contains("保留"), "{reason}");
    }

    #[test]
    fn allows_nesting_up_to_256_and_rejects_257() {
        let ok_input = format!("{}{}", "<a>".repeat(MAX_DEPTH), "</a>".repeat(MAX_DEPTH));
        assert!(format(&ok_input, XmlFormatMode::Indent2).is_ok());

        let deep = format!(
            "{}{}",
            "<a>".repeat(MAX_DEPTH + 1),
            "</a>".repeat(MAX_DEPTH + 1)
        );
        let (line, _, reason) = invalid(&deep);
        assert_eq!(line, 1);
        assert!(reason.contains("256"), "{reason}");
    }

    #[test]
    fn input_limit_is_inclusive_at_one_mebibyte() {
        let at_limit = format!("<a>{}</a>", "x".repeat(MAX_INPUT_BYTES - 7));
        assert_eq!(at_limit.len(), MAX_INPUT_BYTES);
        assert!(format(&at_limit, XmlFormatMode::Indent2).is_ok());

        let over_limit = format!("<a>{}</a>", "x".repeat(MAX_INPUT_BYTES - 6));
        assert_eq!(
            format(&over_limit, XmlFormatMode::Indent2),
            Err(XmlError::InputTooLarge)
        );
    }

    #[test]
    fn output_limit_stops_indentation_expansion() {
        let mut input = "<a>".repeat(255);
        input.push_str(&"<b/>".repeat(200_000));
        input.push_str(&"</a>".repeat(255));
        assert!(input.len() <= MAX_INPUT_BYTES);
        assert_eq!(
            format(&input, XmlFormatMode::Indent4),
            Err(XmlError::OutputTooLarge)
        );
    }
}
