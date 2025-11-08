# Deployment Guide - Raspberry Pi 5

Complete guide for deploying GitLab Pipeline Monitor on Raspberry Pi 5 with Docker.

## 📋 Prerequisites

- Raspberry Pi 5 (4GB+ RAM recommended)
- Raspberry Pi OS (64-bit) or Ubuntu Server
- Docker and Docker Compose installed
- GitLab API token(s) with `read_api` scope

## 🚀 Quick Start

```bash
# 1. Clone repository
git clone https://github.com/genuinefafa/gitlab-pipeline-status-single.git
cd gitlab-pipeline-status-single

# 2. Configure GitLab credentials
cp config.example.yaml config.yaml
nano config.yaml  # Add your tokens and projects

# 3. Start services
docker-compose up -d

# 4. Check logs
docker-compose logs -f gitlab-monitor
```

**Access:**
- GitLab Monitor: http://gitlab.local or http://192.168.1.10 (replace with your Pi5 IP)
- Portainer: http://192.168.1.10:9000 (replace with your Pi5 IP)

## 📦 Architecture

```
Pi5 (Host)
├── Nginx (port 80) - Reverse proxy
│   ├── gitlab.local → GitLab Monitor
│   └── pihole.local → Pi-hole (if enabled)
├── Portainer (port 9000) - Direct access
└── Homebridge (port 8581) - Direct access, host network
```

## ⚙️ Configuration

### 1. GitLab API Configuration

Edit `config.yaml`:

```yaml
refreshInterval: 30

servers:
  - name: "GitLab Main"
    url: "https://gitlab.com"
    tokens:
      - value: "glpat-your-token-here"
        name: "Primary Token"

    # Option A: Monitor specific projects
    projects:
      - path: "group/project-name"

    # Option B: Monitor entire groups
    groups:
      - path: "my-org/production"
        includeSubgroups: true

excludeProjects:
  - "docs"
  - "archived"
```

### 2. Network Configuration

**Option A: Use `.local` domains (recommended)**

Add to your `/etc/hosts` or router DNS:

```
192.168.1.10  gitlab.local
192.168.1.10  pihole.local
```

Replace `192.168.1.10` with your Pi5's IP.

**Note:** Homebridge doesn't need a `.local` domain since it requires direct IP access (http://192.168.1.10:8581) due to host networking requirements.

**Option B: Access by IP**

Modify `nginx/nginx.conf` to use IP-based routing or add a default server block.

### 3. Optional Services

**Enable Homebridge:**

1. Uncomment the `homebridge` service in `docker-compose.yml`
2. Place your Homebridge config in `./homebridge/` directory
3. Update the timezone placeholder (`Your/Timezone`)
4. **Note:** Homebridge uses `network_mode: host` for HomeKit mDNS discovery, which means:
   - It cannot be proxied through nginx
   - Access directly at `http://192.168.1.10:8581` (replace with your Pi5 IP)
   - Do NOT uncomment the nginx homebridge section (it won't work)

**Enable Pi-hole:**

1. Uncomment the `pihole` service in `docker-compose.yml`
2. **⚠️  IMPORTANT:** Change `WEBPASSWORD` from `CHANGE_ME_SECURITY_RISK` to a secure password
3. Update the timezone placeholder (`Your/Timezone`)
4. Uncomment Pi-hole section in `nginx/nginx.conf`

## 🔧 Docker Commands

### Start services

```bash
docker-compose up -d
```

### Stop services

```bash
docker-compose down
```

### View logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f gitlab-monitor
docker-compose logs -f nginx
```

### Rebuild after code changes

```bash
docker-compose up -d --build
```

### Restart a single service

```bash
docker-compose restart gitlab-monitor
```

### Check service health

```bash
docker-compose ps
```

## 📊 Resource Usage

Expected memory usage on Pi5:

| Service | RAM Usage |
|---------|-----------|
| GitLab Monitor | ~150MB |
| Nginx | ~10MB |
| Portainer | ~100MB |
| Homebridge | ~100MB (if enabled) |
| Pi-hole | ~200MB (if enabled) |
| **Total** | **~560MB** |

**Recommendation:** Pi5 with 4GB+ RAM handles this comfortably.

## 🔐 Security Considerations

### 1. Non-root containers

All containers run as non-root users where possible.

### 2. Read-only config

Config file mounted as read-only (`:ro` flag):

```yaml
volumes:
  - ./config.yaml:/app/config.yaml:ro
```

### 3. HTTPS (Optional)

To enable HTTPS with Let's Encrypt:

```bash
# Install certbot
sudo apt install certbot

# Get certificate
sudo certbot certonly --standalone -d gitlab.yourdomain.com

# Update docker-compose.yml
# Uncomment HTTPS port 443
# Uncomment SSL volume mount

# Update nginx.conf
# Add SSL configuration (see nginx documentation)
```

### 4. Firewall

```bash
# Allow HTTP
sudo ufw allow 80/tcp

# Allow HTTPS (if configured)
sudo ufw allow 443/tcp

# Allow Portainer
sudo ufw allow 9000/tcp

# Enable firewall
sudo ufw enable
```

### 5. Docker Secrets for Sensitive Data

Instead of storing passwords in environment variables, use Docker Compose secrets for better security.

**Why use secrets:**
- ✅ Credentials stored in separate files (not in docker-compose.yml)
- ✅ Files can be excluded from git
- ✅ Mounted as read-only in containers
- ✅ Better access control with file permissions

**How to implement:**

1. **Create secret files:**

```bash
# Create password file (outside git repo)
echo "your-strong-password-here" > pihole_password.txt

# Restrict permissions (only you can read)
chmod 600 pihole_password.txt
chown $USER:$USER pihole_password.txt
```

2. **Update docker-compose.yml:**

Add secrets section at the end:

```yaml
# At the end of docker-compose.yml, after volumes:
secrets:
  pihole_password:
    file: ./pihole_password.txt
  # Add more secrets as needed:
  # gitlab_token:
  #   file: ./gitlab_token.txt
```

Update the Pi-hole service:

```yaml
pihole:
  image: pihole/pihole:latest
  # ... other config ...
  secrets:
    - pihole_password
  environment:
    - TZ=Your/Timezone
    # Use _FILE suffix to read from secret file
    - WEBPASSWORD_FILE=/run/secrets/pihole_password
```

3. **Add to .gitignore:**

```bash
echo "*_password.txt" >> .gitignore
echo "*_token.txt" >> .gitignore
echo "*.secret" >> .gitignore
```

4. **How it works:**

- Docker mounts `pihole_password.txt` as read-only at `/run/secrets/pihole_password`
- Pi-hole reads the password from the file (via `_FILE` suffix)
- The actual password never appears in `docker ps` or environment variables
- File permissions (600) prevent unauthorized access

5. **Verify it's working:**

```bash
# Start the service
docker-compose up -d pihole

# Password file is mounted (should show your password)
docker exec pihole cat /run/secrets/pihole_password

# But NOT exposed as environment variable (should be empty)
docker exec pihole sh -c 'echo $WEBPASSWORD'
```

**Alternative: Docker Swarm Secrets (Advanced)**

For production environments requiring encryption at rest:

```bash
# Initialize swarm mode
docker swarm init

# Create encrypted secret
echo "your-password" | docker secret create pihole_password -

# Use docker stack instead of docker-compose
docker stack deploy -c docker-compose.yml pi-stack
```

Note: Swarm secrets require using `docker stack` instead of `docker-compose` and have limited Portainer support.

**Recommendation:** For home/Pi5 deployments, Docker Compose file-based secrets provide adequate security. Only use Swarm secrets if you need encryption at rest or multi-node orchestration.

## 🐛 Troubleshooting

### Service won't start

```bash
# Check logs
docker-compose logs gitlab-monitor

# Common issues:
# - Missing config.yaml
# - Invalid GitLab token
# - Port already in use
```

### Cannot access via gitlab.local

```bash
# Test DNS resolution
ping gitlab.local

# If fails, add to /etc/hosts:
echo "192.168.1.10 gitlab.local" | sudo tee -a /etc/hosts
```

### Out of memory

```bash
# Check memory usage
free -h

# Check Docker stats
docker stats

# If low on memory, disable optional services
```

### Nginx 502 Bad Gateway

```bash
# Check if gitlab-monitor is running
docker ps

# Check gitlab-monitor logs
docker logs gitlab-monitor

# Verify network connectivity
docker exec nginx ping gitlab-monitor
```

### Cache not persisting

```bash
# Verify volume
docker volume inspect gitlab-cache

# Check permissions
docker exec gitlab-monitor ls -la /app/.cache
```

## 🔄 Updates

### Update GitLab Monitor

```bash
# Pull latest code
git pull origin main

# Rebuild and restart
docker-compose up -d --build
```

### Update other images

```bash
# Pull latest images
docker-compose pull

# Restart with new images
docker-compose up -d
```

## 💾 Backups

### Backup configuration

```bash
# Backup config and cache
tar -czf backup-$(date +%Y%m%d).tar.gz \
  config.yaml \
  .cache/
```

### Backup Docker volumes

```bash
# List volumes
docker volume ls

# Backup gitlab-cache volume
docker run --rm \
  -v gitlab-cache:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/gitlab-cache-backup.tar.gz /data
```

## 📈 Monitoring

### Portainer

Access http://192.168.1.10:9000 (replace with your Pi5 IP) for:
- Container status and logs
- Resource usage graphs
- Quick restart/stop controls
- Stack management

### System monitoring

```bash
# CPU and memory
htop

# Docker stats
docker stats

# Disk usage
df -h
docker system df
```

## 🆘 Support

- Issues: https://github.com/genuinefafa/gitlab-pipeline-status-single/issues
- Docs: See README.md and ARCHITECTURE.md

## 📝 Example: Complete Setup

```bash
# 1. Install Docker (if not installed)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker

# 2. Clone and configure
git clone https://github.com/genuinefafa/gitlab-pipeline-status-single.git
cd gitlab-pipeline-status-single
cp config.example.yaml config.yaml
nano config.yaml  # Add your tokens

# 3. Add local DNS
echo "$(hostname -I | cut -d' ' -f1) gitlab.local" | sudo tee -a /etc/hosts

# 4. Start services
docker-compose up -d

# 5. Check everything is running
docker-compose ps

# 6. Access in browser
# http://gitlab.local
# http://$(hostname -I | cut -d' ' -f1):9000
```

Done! Your GitLab Pipeline Monitor is now running on Pi5. 🎉
