use dsh_policy_manager_lib::catalog_update::is_approved_release_redirect;

#[test]
fn allows_redirects_only_between_approved_github_release_hosts() {
    assert!(is_approved_release_redirect(
        "https://github.com/sdaniasdsd/DSH-Policy/releases/download/dsh-policy-manager-catalog/manager-catalog.json",
        "https://objects.githubusercontent.com/github-production-release-asset/123/manager-catalog.json"
    ));
    assert!(!is_approved_release_redirect(
        "https://github.com/sdaniasdsd/DSH-Policy/releases/download/dsh-policy-manager-catalog/manager-catalog.json",
        "https://example.com/manager-catalog.json"
    ));
    assert!(!is_approved_release_redirect(
        "https://github.com/sdaniasdsd/DSH-Policy/releases/download/dsh-policy-manager-catalog/manager-catalog.json",
        "http://objects.githubusercontent.com/manager-catalog.json"
    ));
}
