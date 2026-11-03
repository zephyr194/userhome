use super::is_secret_key;

const REDACTION_CORPUS: &str = include_str!("../../tests/fixtures/redaction_corpus.json");

#[test]
fn shared_redaction_corpus_holds_for_secret_key_detection() {
    let corpus: serde_json::Value =
        serde_json::from_str(REDACTION_CORPUS).expect("redaction corpus is valid JSON");
    let cases: Vec<&serde_json::Value> = corpus["cases"]
        .as_array()
        .expect("corpus has a cases array")
        .iter()
        .filter(|case| {
            case["targets"].as_array().is_some_and(|targets| {
                targets
                    .iter()
                    .any(|entry| entry.as_str() == Some("config_redaction"))
            })
        })
        .collect();
    assert!(
        !cases.is_empty(),
        "the corpus has no config_redaction cases"
    );

    for case in cases {
        let id = case["id"].as_str().expect("case id");
        if case["known_gap"].as_bool() == Some(true) {
            eprintln!("redaction corpus: skipping known gap {id}");
            continue;
        }
        let key = case["input"].as_str().expect("case input");

        if case["kind"].as_str() == Some("negative") {
            assert!(!is_secret_key(key), "{id}: {key:?} is not a secret key");
        } else {
            assert!(is_secret_key(key), "{id}: {key:?} is a secret key");
        }
    }
}
