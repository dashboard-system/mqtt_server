FROM node:18-alpine

# Install dependencies
RUN apk add --no-cache \
    mosquitto \
    mosquitto-clients \
    supervisor

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install npm dependencies
RUN npm ci --only=production

# Copy application code
COPY src/ ./src/

# Create directories
RUN mkdir -p logs uci uci_backup

# Copy example UCI files
COPY uci/ ./uci/

# Create supervisor config
RUN mkdir -p /etc/supervisor/conf.d
COPY supervisord.conf /etc/supervisor/conf.d/

# Expose ports
EXPOSE 1883 3000

# Start supervisor
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
