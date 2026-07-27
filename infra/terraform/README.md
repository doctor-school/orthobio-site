# orthobio-site infrastructure (Terraform)

Provisions the **congress-archive media S3 bucket** on **Timeweb Cloud** —
the infra slice of Issue #2 (assets rescue). The bucket hosts the rescued
2021–2026 archive (photos + PDFs, ~8.9 GiB); the site hotlinks objects
directly (public-read), per the AGENTS.md invariant "Media on Timeweb S3".

Modeled on the ecosystem donor `bbm-public-website/infra/terraform` (same
provider, auth, and state conventions).

## Files

| File           | Purpose                                                    |
| -------------- | ---------------------------------------------------------- |
| `providers.tf` | Terraform + `twc` provider pin (`~> 1.6`); token from env  |
| `media.tf`     | `twc_s3_bucket.media` — the public congress-media bucket   |
| `variables.tf` | `ds_platform_project_id`, bucket name, preset (tier)       |
| `outputs.tf`   | Bucket coordinates + S3 keys for upload tooling / secrets  |

## Auth

The provider reads its API token from the environment. The token is an
**account-level** Timeweb token; its value lives in the owner's secret store —
**not** in this repo.

```sh
export TWC_TOKEN=…   # owner's secret store; never commit
```

## Apply flow

```sh
cd infra/terraform
terraform init      # downloads the twc provider from the public registry (no creds)
terraform plan      # review — should show 1 resource to add (twc_s3_bucket.media)
terraform apply     # creates a paid S3 Hot v2 10GB bucket (79₽/mo) in ds-platform
```

> `terraform apply` orders a **paid** resource. Apply is **owner-gated** — it
> needs `TWC_TOKEN` and hits live paid infra.

## Post-apply wiring

Env var names used by upload tooling (values host-side / secret store only):

| Terraform output         | Env var                 | Used as                 |
| ------------------------ | ----------------------- | ----------------------- |
| `media_s3_hostname`      | `TIMEWEB_S3_ENDPOINT`   | `aws --endpoint-url`    |
| `media_bucket_full_name` | `TIMEWEB_S3_BUCKET`     | sync target bucket      |
| `media_s3_access_key`    | `TIMEWEB_S3_ACCESS_KEY` | `AWS_ACCESS_KEY_ID`     |
| `media_s3_secret_key`    | `TIMEWEB_S3_SECRET_KEY` | `AWS_SECRET_ACCESS_KEY` |

`TIMEWEB_S3_REGION` defaults to `ru-1`. Read sensitive values with
`terraform output -raw <name>` — they will not print in the plain table.

## Uploading the archive

The staging tree (see `docs/assets-manifest.yaml` → `meta.staging_root`) maps
1:1 onto S3 keys. Upload with the AWS CLI against the Timeweb endpoint:

```sh
aws s3 sync <staging_root> "s3://$TIMEWEB_S3_BUCKET/" \
  --endpoint-url "https://$TIMEWEB_S3_ENDPOINT" \
  --exclude "2021/previews/*" \
  --cache-control "public, max-age=31536000, immutable"
```

- `2021/previews/*` is excluded by design: those 3 files are byte-identical to
  same-named objects in `2021/photos/` (manifest dedup note).
- Objects are immutable rescued archives — the long-lived `Cache-Control` is
  intentional (issue #5). Content types are guessed from extensions
  (jpg/png/pdf only in the tree).
- Verify after upload: object count vs manifest, spot SHA-256 checks against
  `docs/assets-checksums.txt`.

Public object URL (path-style):
`https://<media_s3_hostname>/<media_bucket_full_name>/<key>`

## State

State is **local** and **gitignored** (may contain S3 secret keys — keep
`terraform.tfstate` safe on the operator's machine, never commit). No remote
backend is configured, matching the estate convention.
