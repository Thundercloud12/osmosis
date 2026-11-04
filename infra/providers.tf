provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "osmosis"
      Environment = "production"
      ManagedBy   = "Terraform"
    }
  }
}

provider "cloudflare" {}
