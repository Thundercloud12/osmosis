terraform {
  backend "s3" {
    bucket       = "osmosis-tfstate-sexy2223"
    key          = "production/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}
