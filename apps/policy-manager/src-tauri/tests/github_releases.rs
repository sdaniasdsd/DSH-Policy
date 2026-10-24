use dsh_policy_manager_lib::github_releases::parse_release_page;
use serde_json::{Value, json};

fn published_release() -> Value {
    // Public metadata from policy-v1.0.4; no compatibility claim is present.
    json!({
        "tag_name": "policy-v1.0.4",
        "name": "DSH Policy 1.0.4",
        "draft": false,
        "prerelease": false,
        "published_at": "2026-10-23T09:29:05Z",
        "html_url": "https://github.com/sdaniasdsd/DSH-Policy/releases/tag/policy-v1.0.4",
        "target_commitish": "d9d8a440a60980738ece2fbc5f766d4fb9511c81",
        "assets": [{
            "name": "dsh-policy-1.0.4-win-x64-unsigned.exe",
            "browser_download_url": "https://github.com/sdaniasdsd/DSH-Policy/releases/download/policy-v1.0.4/dsh-policy-1.0.4-win-x64-unsigned.exe",
            "digest": "sha256:00ca28f165724757131afb9de0d07866910bc5359eb40bef83c6d64eb807ab11",
            "size": 286624574
        }, {
            "name": "SHA256SUMS.txt",
            "browser_download_url": "https://github.com/sdaniasdsd/DSH-Policy/releases/download/policy-v1.0.4/SHA256SUMS.txt",
            "size": 105
        }]
    })
}

fn parse(values: Vec<Value>) -> Vec<dsh_policy_manager_lib::github_releases::GithubPolicyRelease> {
    parse_release_page(&serde_json::to_vec(&values).unwrap()).unwrap()
}

#[test]
fn discovers_the_published_policy_installer_without_claiming_compatibility() {
    let releases = parse(vec![published_release()]);
    assert_eq!(releases.len(), 1);
    let release = &releases[0];
    assert_eq!(release.tag, "policy-v1.0.4");
    assert_eq!(release.version, "1.0.4");
    assert_eq!(
        release.source_commit.as_deref(),
        Some("d9d8a440a60980738ece2fbc5f766d4fb9511c81")
    );
    let installer = release.installer.as_ref().unwrap();
    assert_eq!(installer.size, 286624574);
    assert_eq!(
        installer.sha256.as_deref(),
        Some("00ca28f165724757131afb9de0d07866910bc5359eb40bef83c6d64eb807ab11")
    );
    let serialized = serde_json::to_value(release).unwrap();
    assert_eq!(serialized["publishedAt"], "2026-10-23T09:29:05Z");
    assert!(serialized.get("compatible").is_none());
}

#[test]
fn excludes_drafts_and_other_products_but_keeps_marked_previews() {
    let mut draft = published_release();
    draft["draft"] = json!(true);
    let mut other = published_release();
    other["tag_name"] = json!("dsh-policy-manager-v0.1.1");
    let mut preview = published_release();
    preview["prerelease"] = json!(true);
    let releases = parse(vec![draft, other, preview]);
    assert_eq!(releases.len(), 1);
    assert!(releases[0].prerelease);
}

#[test]
fn does_not_infer_a_commit_from_a_branch_or_a_hash_from_missing_metadata() {
    for digest in [Value::Null, json!("sha256:bad"), json!("sha512:abcd")] {
        let mut release = published_release();
        release["target_commitish"] = json!("main");
        release["assets"][0]["digest"] = digest;
        let releases = parse(vec![release]);
        assert_eq!(releases[0].source_commit, None);
        assert_eq!(releases[0].installer.as_ref().unwrap().sha256, None);
    }
}

#[test]
fn does_not_offer_an_installer_outside_this_repository_and_release_tag() {
    for url in [
        "https://github.com/attacker/DSH-Policy/releases/download/policy-v1.0.4/dsh-policy-1.0.4-win-x64-unsigned.exe",
        "https://github.com/sdaniasdsd/DSH-Policy/releases/download/policy-v1.0.3/dsh-policy-1.0.4-win-x64-unsigned.exe",
        "https://github.com/sdaniasdsd/DSH-Policy/releases/download/policy-v1.0.4/dsh-policy-1.0.4-win-x64-unsigned.exe?token=secret",
    ] {
        let mut release = published_release();
        release["assets"][0]["browser_download_url"] = json!(url);
        assert!(parse(vec![release])[0].installer.is_none());
    }
}

#[test]
fn excludes_a_release_link_to_another_repository() {
    let mut release = published_release();
    release["html_url"] =
        json!("https://github.com/attacker/DSH-Policy/releases/tag/policy-v1.0.4");
    assert!(parse(vec![release]).is_empty());
}

#[test]
fn rejects_malformed_or_oversized_api_responses() {
    assert!(parse_release_page(br#"{"message":"API rate limit exceeded"}"#).is_err());
    assert!(parse_release_page(&vec![b' '; 2 * 1024 * 1024 + 1]).is_err());
}

#[test]
fn audited_base_is_separate_from_extension_compatibility() {
    let releases = parse(vec![published_release()]);
    let record = serde_json::to_value(&releases[0]).unwrap();
    assert_eq!(record["officialBase"]["version"], "0.2.1-alpha.3");
    assert_eq!(record["officialBase"]["tag"], "dsh-v0.2.1-alpha.3");
    assert_eq!(record["officialBase"]["verification"], "declared");
    assert_eq!(record["officialBase"]["commit"], Value::Null);
    assert!(
        record["officialBase"]["sourceUrl"]
            .as_str()
            .unwrap()
            .starts_with("https://github.com/sdaniasdsd/DSH-Policy/tree/")
    );
    assert!(record.get("compatible").is_none());
}

#[test]
fn every_audited_historical_release_has_pinned_evidence_and_an_honest_verification_state() {
    let records: Vec<Value> =
        serde_json::from_str(include_str!("../../catalog/policy-bases.json")).unwrap();
    assert_eq!(records.len(), 9);
    let mut tags = std::collections::HashSet::new();
    for record in records {
        let tag = record["policyTag"].as_str().unwrap();
        let commit = record["policyCommit"].as_str().unwrap();
        assert!(tags.insert(tag.to_owned()));
        assert!(tag.starts_with("policy-v"));
        assert_eq!(commit.len(), 40);
        assert!(commit.bytes().all(|byte| byte.is_ascii_hexdigit()));
        let mut release = published_release();
        release["tag_name"] = json!(tag);
        release["html_url"] = json!(format!(
            "https://github.com/sdaniasdsd/DSH-Policy/releases/tag/{tag}"
        ));
        release["target_commitish"] = json!(commit);
        let parsed = parse(vec![release]);
        let data = serde_json::to_value(&parsed[0]).unwrap();
        let base = &data["officialBase"];
        assert_eq!(
            base["sourceUrl"],
            format!("https://github.com/sdaniasdsd/DSH-Policy/tree/{commit}")
        );
        assert!(!base["version"].as_str().unwrap().is_empty());
        assert_eq!(
            base["tag"],
            format!("dsh-v{}", base["version"].as_str().unwrap())
        );
        assert_eq!(base["verification"], "declared");
        assert!(base["commit"].is_null());
        assert!(!base["note"].as_str().unwrap().is_empty());
    }
}

#[test]
fn unknown_or_retargeted_policy_releases_do_not_inherit_an_official_base() {
    for (tag, commit) in [
        ("policy-v9.9.9", "d9d8a440a60980738ece2fbc5f766d4fb9511c81"),
        ("policy-v1.0.4", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    ] {
        let mut release = published_release();
        release["tag_name"] = json!(tag);
        release["html_url"] = json!(format!(
            "https://github.com/sdaniasdsd/DSH-Policy/releases/tag/{tag}"
        ));
        release["target_commitish"] = json!(commit);
        let records = parse(vec![release]);
        let record = serde_json::to_value(&records[0]).unwrap();
        assert_eq!(record["officialBase"], Value::Null);
    }
}

#[test]
fn a_branch_or_missing_release_target_does_not_verify_a_historical_source_commit() {
    for target in [Value::Null, json!("main")] {
        let mut release = published_release();
        release["target_commitish"] = target;
        let records = parse(vec![release]);
        let record = serde_json::to_value(&records[0]).unwrap();
        assert!(record["officialBase"].is_null());
    }
}

#[test]
fn an_installer_with_a_different_package_version_is_not_offered_for_the_release() {
    let mut release = published_release();
    release["assets"][0]["name"] = json!("dsh-policy-1.0.3-win-x64-unsigned.exe");
    release["assets"][0]["browser_download_url"] = json!(
        "https://github.com/sdaniasdsd/DSH-Policy/releases/download/policy-v1.0.4/dsh-policy-1.0.3-win-x64-unsigned.exe"
    );
    assert!(parse(vec![release])[0].installer.is_none());
}
