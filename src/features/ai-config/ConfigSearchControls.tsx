import { Fragment, useRef, type KeyboardEvent } from "react";
import { Button } from "../../components/ui";
import { TextField } from "../../components/ui/forms";
import { MAX_QUERY_LENGTH, highlightSegments } from "./configSearch";

export const SEARCH_PLACEHOLDER = "搜索配置项（键名或说明）";

export interface ConfigSearchBarProps {
  readonly query: string;
  /** Undefined while the selected tool's items are still loading, so no count is claimed. */
  readonly matchCount: number | undefined;
  readonly onQueryChange: (query: string) => void;
}

export function ConfigSearchBar({ query, matchCount, onQueryChange }: ConfigSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const clear = () => {
    onQueryChange("");
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape" || query === "") return;
    event.preventDefault();
    clear();
  };

  return (
    <div className="config-search grid min-w-0 gap-ui-4">
      <div className="flex min-w-0 flex-wrap items-end gap-ui-8">
        <TextField
          label="搜索配置项"
          placeholder={SEARCH_PLACEHOLDER}
          inputRef={inputRef}
          className="min-w-0 flex-1"
          value={query}
          maxLength={MAX_QUERY_LENGTH}
          autoComplete="off"
          spellCheck={false}
          onKeyDown={onKeyDown}
          onValueChange={onQueryChange}
        />
        {query === "" ? null : (
          <Button variant="ghost" onClick={clear}>
            清除
          </Button>
        )}
      </div>
      <p aria-live="polite" className="m-0 text-aux text-muted-foreground">
        {query !== "" && matchCount !== undefined ? `匹配 ${matchCount} 项` : "\u00a0"}
      </p>
    </div>
  );
}

export function HighlightText({
  text,
  terms,
}: {
  readonly text: string;
  readonly terms: readonly string[];
}) {
  return (
    <>
      {highlightSegments(text, terms).map((segment, index) =>
        segment.marked ? (
          <mark key={index} className="config-search-mark">
            {segment.text}
          </mark>
        ) : (
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}
