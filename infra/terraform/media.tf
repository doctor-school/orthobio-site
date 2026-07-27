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
# Note: the canonical bucket name is `twc_s3_bucket.media.full_name` (exposed
# as the `media_bucket_full_name` output) — for this bucket it equals `name`
# (no account prefix was applied on create), but tooling should still read
# full_name rather than assume the two match.

resource "twc_s3_bucket" "media" {
  name       = var.media_bucket_name
  type       = "public"                    # public-read objects; site hotlinks media
  preset_id  = var.media_bucket_preset_id  # see variables.tf for tier rationale
  project_id = var.ds_platform_project_id  # ds-platform scope (Doctor.School estate)

  # The archive already fills ~87% of the 10GB tier; without auto-upgrade the
  # 2026 gallery rescue would hit the ceiling mid-sync (PR #13 review).
  is_allow_auto_upgrade = true
}
