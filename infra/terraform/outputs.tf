# Outputs — bucket coordinates + S3 keys for upload tooling / GitHub Secrets.
# Read sensitive values with `terraform output -raw <name>`; never commit or
# print them.

output "media_bucket_name" {
  description = "Unprefixed bucket name as requested (var.media_bucket_name). Informational — tooling uses media_bucket_full_name, not this."
  value       = twc_s3_bucket.media.name
}

output "media_bucket_full_name" {
  description = "Canonical bucket name (equals var.media_bucket_name for this bucket — no account prefix was applied). → TIMEWEB_S3_BUCKET (sync target / path-style bucket segment)."
  value       = twc_s3_bucket.media.full_name
}

output "media_s3_hostname" {
  description = "S3 endpoint host for this bucket. → TIMEWEB_S3_ENDPOINT (aws --endpoint-url)."
  value       = twc_s3_bucket.media.hostname
}

output "media_s3_access_key" {
  description = "S3 access key for the bucket. → TIMEWEB_S3_ACCESS_KEY (AWS_ACCESS_KEY_ID)."
  value       = twc_s3_bucket.media.access_key
  sensitive   = true
}

output "media_s3_secret_key" {
  description = "S3 secret key for the bucket. → TIMEWEB_S3_SECRET_KEY (AWS_SECRET_ACCESS_KEY)."
  value       = twc_s3_bucket.media.secret_key
  sensitive   = true
}
