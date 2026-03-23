resource "digitalocean_firewall" "finbot" {
    name        = "finbot-prod-firewall"
    droplet_ids = [digitalocean_droplet.server.id]

    # ── Inbound ───────────────────────────────────────────────────────────────

    # SSH — how you and GitHub Actions connect to the server
    inbound_rule {
      protocol         = "tcp"
      port_range       = "22"
      source_addresses = ["0.0.0.0/0", "::/0"]
    }

    # HTTP — needed for Let's Encrypt certificate challenge
    inbound_rule {
      protocol         = "tcp"
      port_range       = "80"
      source_addresses = ["0.0.0.0/0", "::/0"]
    }

    # HTTPS — public API traffic
    inbound_rule {
      protocol         = "tcp"
      port_range       = "443"
      source_addresses = ["0.0.0.0/0", "::/0"]
    }

    # finbot-api — REST API
    inbound_rule {
      protocol         = "tcp"
      port_range       = "3000"
      source_addresses = ["0.0.0.0/0", "::/0"]
    }

    # trading-agents — Python API
    inbound_rule {
      protocol         = "tcp"
      port_range       = "8000"
      source_addresses = ["0.0.0.0/0", "::/0"]
    }

    # ── Outbound ──────────────────────────────────────────────────────────────
    # Allow all outbound — server needs to pull Docker images,
    # call external APIs (HuggingFace, Pinecone, Datadog, etc.)

    outbound_rule {
      protocol              = "tcp"
      port_range            = "1-65535"
      destination_addresses = ["0.0.0.0/0", "::/0"]
    }

    outbound_rule {
      protocol              = "udp"
      port_range            = "1-65535"
      destination_addresses = ["0.0.0.0/0", "::/0"]
    }

    # ICMP — allows ping, useful for debugging
    outbound_rule {
      protocol              = "icmp"
      destination_addresses = ["0.0.0.0/0", "::/0"]
    }
  }