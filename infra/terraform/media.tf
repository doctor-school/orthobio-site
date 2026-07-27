# Congress archive media bucket (Issue #2).
#
# Dedicated public-read S3 bucket for the rescued 2021–2026 congress archive
# (photos + PDFs, ~8.9 GiB, 2219 objects — see docs/assets-manifest.yaml).
# The Astro site serves media straight off the bucket URL; objects are
# uploaded once with long-lived immutable Cache-Control headers (issue #5).
#
# `type = "public"` makes objects readable without credentials — required for
# the site (and any future CDN origin-pull) to fetch media unauthenticated.
#
# Note: Timeweb prefixes the account id onto `name`, so the actual bucket name
# is `twc_s3_bucket.media.full_name` (exposed as the `media_bucket_full_name`
# output) — use that for path-style S3 URLs and upload tooling.

resource "twc_s3_bucket" "media" {
  name       = var.media_bucket_name
  type       = "public"                    # public-read objects; site hotlinks media
  preset_id  = var.media_bucket_preset_id  # see variables.tf for tier rationale
  project_id = var.ds_platform_project_id  # ds-platform scope (Doctor.School estate)
}
