use unicode_normalization::{UnicodeNormalization, is_nfc};

use crate::contracts::PlanProblem;

pub const NAME_LIMIT: usize = 255;

const INVALID_CHARACTERS: [char; 9] = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

const RESERVED_NAMES: [&str; 30] = [
    "CON", "PRN", "AUX", "NUL", "COM0", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
    "COM8", "COM9", "COM¹", "COM²", "COM³", "LPT0", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6",
    "LPT7", "LPT8", "LPT9", "LPT¹", "LPT²", "LPT³",
];

pub fn validate_name(name: &str) -> Vec<PlanProblem> {
    if name.is_empty() {
        return vec![PlanProblem::EmptyName];
    }

    let mut problems = Vec::new();

    let mut invalid_characters: Vec<String> = Vec::new();
    for character in name
        .chars()
        .filter(|character| is_invalid_character(*character))
    {
        let text = character.to_string();
        if !invalid_characters.contains(&text) {
            invalid_characters.push(text);
        }
    }
    if !invalid_characters.is_empty() {
        problems.push(PlanProblem::InvalidCharacters {
            characters: invalid_characters,
        });
    }

    if let Some(reserved) = reserved_name(name) {
        problems.push(PlanProblem::ReservedName {
            reserved: reserved.to_string(),
        });
    }
    if name.ends_with(['.', ' ']) {
        problems.push(PlanProblem::EndsWithDotOrSpace);
    }
    if name.starts_with('.') {
        problems.push(PlanProblem::StartsWithDot);
    }
    if !is_nfc(name) {
        problems.push(PlanProblem::NotNormalised);
    }

    let length = name.encode_utf16().count();
    if length > NAME_LIMIT {
        problems.push(PlanProblem::NameTooLong {
            length,
            limit: NAME_LIMIT,
        });
    }

    problems
}

pub fn collision_key(path: &str) -> String {
    path.nfc().collect::<String>().to_lowercase()
}

pub fn safe_fragment(name: &str) -> String {
    let replaced: String = name
        .nfc()
        .map(|character| {
            if is_invalid_character(character) {
                '_'
            } else {
                character
            }
        })
        .collect();
    replaced.trim_end_matches(['.', ' ']).to_string()
}

fn is_invalid_character(character: char) -> bool {
    character < ' ' || INVALID_CHARACTERS.contains(&character)
}

fn reserved_name(name: &str) -> Option<&'static str> {
    let stem = name
        .split('.')
        .next()
        .unwrap_or(name)
        .trim_end_matches([' ', '.']);
    RESERVED_NAMES
        .iter()
        .find(|reserved| reserved.eq_ignore_ascii_case(stem))
        .copied()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct NameRuleCase {
        description: String,
        stem: String,
        extension: String,
        sanitised: String,
        raw_is_valid: bool,
    }

    #[derive(Deserialize)]
    struct NameRules {
        cases: Vec<NameRuleCase>,
    }

    #[test]
    fn shared_fixture_agrees_with_validation() {
        let rules: NameRules =
            serde_json::from_str(include_str!("../../fixtures/name-rules.json")).unwrap();

        for case in rules.cases {
            let sanitised_problems = validate_name(&case.sanitised);
            assert!(
                sanitised_problems.is_empty(),
                "{}: sanitised name {:?} failed validation: {:?}",
                case.description,
                case.sanitised,
                sanitised_problems
            );

            let raw = format!("{}{}", case.stem, case.extension);
            assert_eq!(
                validate_name(&raw).is_empty(),
                case.raw_is_valid,
                "{}: raw name {:?}",
                case.description,
                raw
            );
        }
    }

    #[test]
    fn safe_fragments_always_validate() {
        for name in [
            "Poke\u{301}mon.mkv",
            "Re:Zero?.mkv",
            "trailing. ",
            "a\tb",
            "plain.mkv",
        ] {
            let fragment = format!("dub-tmp-x-1-{}", safe_fragment(name));
            assert!(
                validate_name(&fragment).is_empty(),
                "{fragment:?} should be valid"
            );
        }
    }
}
