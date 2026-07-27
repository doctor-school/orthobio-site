# Input variables for the orthobio-site Terraform.

variable "ds_platform_project_id" {
  description = <<-EOT
    Timeweb Cloud project-scope id for `ds-platform`. orthobio.ru is a
    Doctor.School property (the site will be replaced by the Doctor.School
    platform module ~Nov 2026), so its media bucket belongs to the ds-platform
    project rather than the BBM scopes. Override only if the estate's project
    layout changes.
  EOT
  type        = number
  default     = 2568419
}

variable "media_bucket_name" {
  description = <<-EOT
    Desired name for the congress-archive media bucket. The canonical name is
    exposed via the `media_bucket_full_name` output — for this bucket it equals
    this value (Timeweb applied no account prefix), but tooling should read
    the output rather than assume the two match.
  EOT
  type        = string
  default     = "orthobio-media"
}

variable "media_bucket_preset_id" {
  description = <<-EOT
    Timeweb S3 storage preset (tier). 2669 = "S3 Hot v2 10GB" (79₽/mo, ru-1,
    Hot, non-promo) — the right class for site media: fast reads, no retrieval
    fees. The archive is ~8.9 GiB (~9.3 GB decimal), which fits in the 10GB
    tier but leaves only ~7% headroom — auto-upgrade is therefore explicitly
    enabled on the resource (`is_allow_auto_upgrade = true` in media.tf) so
    future assets (e.g. the 2026 photo gallery once rescued) don't hit the
    ceiling mid-sync. NOTE: the cheaper promo tier 2667 ("S3 Hot v2 1GB
    Promo") is a one-per-account promo already consumed elsewhere in the
    estate and is too small anyway.
  EOT
  type        = number
  default     = 2669
}
