# Copy this call into the owning DevOps root. Do not apply it from a new local state.
terraform {
  required_version = ">= 1.7, < 2.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}

provider "aws" {
  region              = "ap-southeast-2"
  allowed_account_ids = ["352329340196"]
  # Local: AWS_PROFILE=acquire. CI: company GitHub OIDC role, never copied session keys.
}

variable "initial_app_image" {
  type = string
}

module "acquire_uat_app" {
  source            = ".."
  initial_app_image = var.initial_app_image
}

output "release_config" {
  value = module.acquire_uat_app.release_config
}
