terraform {
  required_version = ">= 1.12, < 2.0"
  backend "s3" {
    bucket       = "tg-state-develop-acquire-ap-southeast-2"
    key          = "applications/stacks/research-develop/terraform.tfstate"
    region       = "ap-southeast-2"
    encrypt      = true
    use_lockfile = true
  }
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
provider "aws" {
  region              = "ap-southeast-2"
  allowed_account_ids = ["352329340196"]
  default_tags {
    tags = {
      project     = "acquire"
      environment = "develop"
      component   = "research"
      repo        = "https://github.com/Sansoni-Management-Dev-Team/acquired"
      managed_by  = "terraform-research"
    }
  }
}
