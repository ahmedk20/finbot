output "server_ip" {
    description = "Public IP of the finbot production server"
    value       = digitalocean_droplet.server.ipv4_address
  }

  output "server_id" {
    description = "DigitalOcean Droplet ID"
    value       = digitalocean_droplet.server.id
  }

  output "ssh_command" {
    description = "SSH command to connect to the server"
    value       = "ssh deploy@${digitalocean_droplet.server.ipv4_address}"
  }