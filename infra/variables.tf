  variable "do_token" {
    description = "DigitalOcean API token"
    type        = string
    sensitive   = true  # won't be printed in plan/apply output
  }

  variable "region" {
    description = "DigitalOcean region to deploy in"
    type        = string
    default     = "nyc3"
  }

    variable "droplet_size" {
    description = "Droplet size slug"
    type        = string
    default     = "s-2vcpu-4gb"  # 2 CPU, 4GB RAM — enough for all FinBot services
  }

    variable "ssh_public_key" {
    description = "SSH public key for server access (paste contents of ~/.ssh/id_rsa.pub)"
    type        = string
  }