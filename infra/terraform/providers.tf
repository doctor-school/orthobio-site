# Terraform + provider configuration for the orthobio-site infrastructure.
#
# Provider: timeweb-cloud/timeweb-cloud ("twc"), same pattern as the ecosystem
# donor bbm-public-website/infra/terraform. The provider reads its API token
# from the environment variable TWC_TOKEN, so the `provider "twc"` block is
# intentionally empty — no token is committed to the repo. Export it before
# running terraform:  export TWC_TOKEN=…  (owner's secret store).
#
# Version pin `~> 1.6` matches the live estate lock.

terraform {
  required_version = ">= 1.6"

  required_providers {
    twc = {
      source  = "timeweb-cloud/timeweb-cloud"
      version = "~> 1.6"
    }
  }
}

provider "twc" {} # token from env TWC_TOKEN
