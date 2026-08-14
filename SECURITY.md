# Security Policy

## Public repository boundary

This repository is public. Treat every committed file as information that may be copied, indexed, forked, or archived by third parties.

Never commit:

- API keys, access tokens, passwords, private keys, cookies, or production credentials.
- Real patient identifiers, medical records, screenshots containing PHI, or hospital-confidential information.
- `.env` files containing real secrets.
- Third-party source material that is not cleared for public redistribution.
- Private datasets, raw internal exports, or proprietary deployment configuration.

## If a secret is exposed

1. Revoke or rotate it immediately. Deleting the file from the latest commit is not sufficient.
2. Remove the secret from Git history where appropriate.
3. Review access logs and downstream systems that used the credential.
4. Replace the credential in the deployment platform using its secret-management mechanism.

## Medical content

Clinical and educational content in this project must not be treated as an automatically current clinical protocol. Changes involving drug doses, contraindications, resuscitation algorithms, disposition thresholds, or guideline-dependent recommendations should be reviewed against current authoritative sources before release.

## Reporting

Do not post secrets, PHI, or sensitive institutional information in a public GitHub issue. Use a private communication channel for sensitive reports.
