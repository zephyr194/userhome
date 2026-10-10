use std::collections::HashSet;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;

use super::{is_bounded_text, is_kebab_case};

pub const SOURCE_FORMAT_VERSION: u16 = 1;
pub const SOURCE_STALE_AFTER_DAYS: u16 = 90;

const MAX_SOURCE_BYTES: usize = 256 * 1024;
const MAX_AUTHORITIES: usize = 64;
const MAX_SOURCES: usize = 512;
const MAX_AUTHORITY_VALUES: usize = 32;
const MAX_SOURCE_SCOPES: usize = 16;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SourceValidationError {
    DocumentTooLarge,
    InvalidDocument,
    UnsupportedFormatVersion,
    TooManyEntries,
    InvalidIdentifier,
    DuplicateAuthorityId,
    DuplicateDomain,
    DuplicateRepositoryOwner,
    DuplicateSourceId,
    UnknownAuthority,
    InvalidOfficialDomain,
    InvalidRepositoryOwner,
    InvalidCanonicalUrl,
    UnofficialCanonicalUrl,
    InvalidRevision,
    MissingIntegrity,
    InvalidContentDigest,
    InvalidVerifiedAt,
    InvalidLicense,
    InvalidScope,
    UnsupportedValue,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceCatalog {
    format_version: u16,
    #[serde(default)]
    normalization: SourceNormalization,
    authorities: Vec<OfficialSourceAuthority>,
    sources: Vec<SourceDefinition>,
}

impl SourceCatalog {
    pub fn format_version(&self) -> u16 {
        self.format_version
    }

    pub fn normalization(&self) -> SourceNormalization {
        self.normalization
    }

    pub fn authorities(&self) -> &[OfficialSourceAuthority] {
        &self.authorities
    }

    pub fn sources(&self) -> &[SourceDefinition] {
        &self.sources
    }

    pub fn source(&self, source_id: &str) -> Option<&SourceDefinition> {
        self.sources
            .iter()
            .find(|source| source.source_id == source_id)
    }

    pub fn contains_approved(&self, source_id: &str) -> bool {
        self.source(source_id)
            .is_some_and(|source| source.review_status == SourceReviewStatus::Approved)
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SourceNormalization {
    #[default]
    FactsOnly,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OfficialSourceAuthority {
    authority_id: String,
    display_name: String,
    domains: Vec<String>,
    repository_owners: Vec<String>,
}

impl OfficialSourceAuthority {
    pub fn authority_id(&self) -> &str {
        &self.authority_id
    }

    pub fn display_name(&self) -> &str {
        &self.display_name
    }

    pub fn domains(&self) -> &[String] {
        &self.domains
    }

    pub fn repository_owners(&self) -> &[String] {
        &self.repository_owners
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SourceKind {
    OfficialDocumentation,
    OfficialRepository,
    OfficialSchema,
    OfficialRelease,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SourceScope {
    AppIdentity,
    FieldSchema,
    Preset,
    VersionRange,
    DocumentationText,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SourceReviewStatus {
    Approved,
    NeedsReview,
    Rejected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LicenseReviewStatus {
    Approved,
    NeedsReview,
    NotApplicable,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceLicense {
    status: LicenseReviewStatus,
    spdx_id: Option<String>,
}

impl SourceLicense {
    pub fn status(&self) -> LicenseReviewStatus {
        self.status
    }

    pub fn spdx_id(&self) -> Option<&str> {
        self.spdx_id.as_deref()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ImmutableRevision {
    Commit { value: String },
    Tag { value: String },
    Release { value: String },
}

impl ImmutableRevision {
    pub fn value(&self) -> &str {
        match self {
            Self::Commit { value } | Self::Tag { value } | Self::Release { value } => value,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceDefinition {
    source_id: String,
    kind: SourceKind,
    authority_id: String,
    project: String,
    canonical_url: String,
    immutable_revision: Option<ImmutableRevision>,
    content_sha256: Option<String>,
    verified_at: String,
    license: SourceLicense,
    review_status: SourceReviewStatus,
    scopes: Vec<SourceScope>,
}

impl SourceDefinition {
    pub fn source_id(&self) -> &str {
        &self.source_id
    }

    pub fn kind(&self) -> SourceKind {
        self.kind
    }

    pub fn authority_id(&self) -> &str {
        &self.authority_id
    }

    pub fn project(&self) -> &str {
        &self.project
    }

    pub fn canonical_url(&self) -> &str {
        &self.canonical_url
    }

    pub fn immutable_revision(&self) -> Option<&ImmutableRevision> {
        self.immutable_revision.as_ref()
    }

    pub fn content_sha256(&self) -> Option<&str> {
        self.content_sha256.as_deref()
    }

    pub fn verified_at(&self) -> &str {
        &self.verified_at
    }

    pub fn license(&self) -> &SourceLicense {
        &self.license
    }

    pub fn review_status(&self) -> SourceReviewStatus {
        self.review_status
    }

    pub fn scopes(&self) -> &[SourceScope] {
        &self.scopes
    }

    pub fn is_stale_at(&self, now_unix_seconds: i64) -> bool {
        parse_verified_at(&self.verified_at).is_some_and(|verified_at| {
            verified_at > now_unix_seconds
                || now_unix_seconds.saturating_sub(verified_at)
                    >= i64::from(SOURCE_STALE_AFTER_DAYS) * 86_400
        })
    }
}

pub fn parse_source_catalog(source: &str) -> Result<SourceCatalog, SourceValidationError> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err(SourceValidationError::DocumentTooLarge);
    }

    let catalog: SourceCatalog =
        serde_json::from_str(source).map_err(|_| SourceValidationError::InvalidDocument)?;
    validate_source_catalog(&catalog)?;
    Ok(catalog)
}

fn validate_source_catalog(catalog: &SourceCatalog) -> Result<(), SourceValidationError> {
    if catalog.format_version != SOURCE_FORMAT_VERSION {
        return Err(SourceValidationError::UnsupportedFormatVersion);
    }
    if catalog.authorities.len() > MAX_AUTHORITIES || catalog.sources.len() > MAX_SOURCES {
        return Err(SourceValidationError::TooManyEntries);
    }

    let mut authority_ids = HashSet::with_capacity(catalog.authorities.len());
    let mut domains = HashSet::new();
    let mut repository_owners = HashSet::new();
    for authority in &catalog.authorities {
        if !is_kebab_case(&authority.authority_id) {
            return Err(SourceValidationError::InvalidIdentifier);
        }
        if !authority_ids.insert(authority.authority_id.as_str()) {
            return Err(SourceValidationError::DuplicateAuthorityId);
        }
        if !is_bounded_text(&authority.display_name)
            || authority.domains.len() > MAX_AUTHORITY_VALUES
            || authority.repository_owners.len() > MAX_AUTHORITY_VALUES
            || (authority.domains.is_empty() && authority.repository_owners.is_empty())
        {
            return Err(SourceValidationError::UnsupportedValue);
        }
        for domain in &authority.domains {
            if !is_official_domain(domain) {
                return Err(SourceValidationError::InvalidOfficialDomain);
            }
            if !domains.insert(domain.as_str()) {
                return Err(SourceValidationError::DuplicateDomain);
            }
        }
        for owner in &authority.repository_owners {
            if !is_repository_owner(owner) {
                return Err(SourceValidationError::InvalidRepositoryOwner);
            }
            if !repository_owners.insert(owner.to_ascii_lowercase()) {
                return Err(SourceValidationError::DuplicateRepositoryOwner);
            }
        }
    }

    let mut source_ids = HashSet::with_capacity(catalog.sources.len());
    for source in &catalog.sources {
        if !is_kebab_case(&source.source_id) || !is_bounded_text(&source.project) {
            return Err(SourceValidationError::InvalidIdentifier);
        }
        if !source_ids.insert(source.source_id.as_str()) {
            return Err(SourceValidationError::DuplicateSourceId);
        }
        let authority = catalog
            .authorities
            .iter()
            .find(|authority| authority.authority_id == source.authority_id)
            .ok_or(SourceValidationError::UnknownAuthority)?;
        validate_source_url(source, authority)?;
        validate_revision(source.immutable_revision.as_ref())?;
        if source.immutable_revision.is_none() && source.content_sha256.is_none() {
            return Err(SourceValidationError::MissingIntegrity);
        }
        if source
            .content_sha256
            .as_deref()
            .is_some_and(|digest| !is_sha256(digest))
        {
            return Err(SourceValidationError::InvalidContentDigest);
        }
        let verified_at = parse_verified_at(&source.verified_at)
            .ok_or(SourceValidationError::InvalidVerifiedAt)?;
        if current_unix_seconds().is_none_or(|now| verified_at > now) {
            return Err(SourceValidationError::InvalidVerifiedAt);
        }
        validate_license(&source.license)?;
        if source.scopes.is_empty() || source.scopes.len() > MAX_SOURCE_SCOPES {
            return Err(SourceValidationError::InvalidScope);
        }
        let mut scopes = HashSet::with_capacity(source.scopes.len());
        if source.scopes.iter().any(|scope| !scopes.insert(*scope)) {
            return Err(SourceValidationError::InvalidScope);
        }
    }
    Ok(())
}

fn validate_source_url(
    source: &SourceDefinition,
    authority: &OfficialSourceAuthority,
) -> Result<(), SourceValidationError> {
    let (host, path) =
        parse_https_url(&source.canonical_url).ok_or(SourceValidationError::InvalidCanonicalUrl)?;
    if host == "github.com" {
        if path.contains('%') {
            return Err(SourceValidationError::InvalidCanonicalUrl);
        }
        let components = path
            .strip_prefix('/')
            .ok_or(SourceValidationError::InvalidCanonicalUrl)?
            .split('/')
            .collect::<Vec<_>>();
        if components.len() < 2
            || components
                .iter()
                .any(|component| component.is_empty() || matches!(*component, "." | ".."))
        {
            return Err(SourceValidationError::InvalidCanonicalUrl);
        }
        let mut components = components.into_iter();
        let owner = components
            .next()
            .ok_or(SourceValidationError::InvalidCanonicalUrl)?;
        components
            .next()
            .ok_or(SourceValidationError::InvalidCanonicalUrl)?;
        if !authority
            .repository_owners
            .iter()
            .any(|allowed| allowed.eq_ignore_ascii_case(owner))
        {
            return Err(SourceValidationError::UnofficialCanonicalUrl);
        }
    } else if !authority
        .domains
        .iter()
        .any(|domain| host == domain || host.ends_with(&format!(".{domain}")))
    {
        return Err(SourceValidationError::UnofficialCanonicalUrl);
    }
    Ok(())
}

fn validate_revision(revision: Option<&ImmutableRevision>) -> Result<(), SourceValidationError> {
    let Some(revision) = revision else {
        return Ok(());
    };
    let valid = match revision {
        ImmutableRevision::Commit { value } => {
            value.len() == 40
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        }
        ImmutableRevision::Tag { value } | ImmutableRevision::Release { value } => {
            is_bounded_text(value) && !value.contains(char::is_whitespace)
        }
    };
    if !valid {
        return Err(SourceValidationError::InvalidRevision);
    }
    Ok(())
}

fn validate_license(license: &SourceLicense) -> Result<(), SourceValidationError> {
    let valid = match license.status {
        LicenseReviewStatus::Approved => license.spdx_id.as_deref().is_some_and(is_bounded_text),
        LicenseReviewStatus::NeedsReview => license.spdx_id.as_deref().is_none_or(is_bounded_text),
        LicenseReviewStatus::NotApplicable => license.spdx_id.is_none(),
    };
    if !valid {
        return Err(SourceValidationError::InvalidLicense);
    }
    Ok(())
}

pub(crate) fn parse_https_url(value: &str) -> Option<(&str, &str)> {
    if !value.is_ascii()
        || value
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
        || value.contains(['?', '#', '\\'])
    {
        return None;
    }
    let rest = value.strip_prefix("https://")?;
    let authority_end = rest.find('/').unwrap_or(rest.len());
    let host = &rest[..authority_end];
    if host.is_empty()
        || host.contains(['@', ':'])
        || host.bytes().any(|byte| byte.is_ascii_uppercase())
        || !is_official_domain(host)
    {
        return None;
    }
    Some((host, &rest[authority_end..]))
}

fn is_official_domain(value: &str) -> bool {
    value.len() <= 253
        && value.contains('.')
        && value.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
}

fn is_repository_owner(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && !value.starts_with('-')
        && !value.ends_with('-')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

pub(crate) fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(crate) fn parse_verified_at(value: &str) -> Option<i64> {
    if !value.is_ascii()
        || value.len() != 20
        || &value[4..5] != "-"
        || &value[7..8] != "-"
        || &value[10..11] != "T"
        || &value[13..14] != ":"
        || &value[16..17] != ":"
        || &value[19..20] != "Z"
    {
        return None;
    }

    let year = value[0..4].parse::<i64>().ok()?;
    let month = value[5..7].parse::<i64>().ok()?;
    let day = value[8..10].parse::<i64>().ok()?;
    let hour = value[11..13].parse::<i64>().ok()?;
    let minute = value[14..16].parse::<i64>().ok()?;
    let second = value[17..19].parse::<i64>().ok()?;
    if !(1970..=9999).contains(&year)
        || !(1..=12).contains(&month)
        || !(1..=days_in_month(year, month)).contains(&day)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }
    Some(days_from_civil(year, month, day) * 86_400 + hour * 3_600 + minute * 60 + second)
}

pub(crate) fn current_unix_seconds() -> Option<i64> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_secs()).ok())
}

fn days_in_month(year: i64, month: i64) -> i64 {
    match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = year.div_euclid(400);
    let year_of_era = year - era * 400;
    let adjusted_month = month + if month > 2 { -3 } else { 9 };
    let day_of_year = (153 * adjusted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}
