# ELN Server Database Installation Guide

This guide provides detailed instructions for installing and configuring the database server for the Electronic Lab Notebook (ELN) system.

## Table of Contents

1. [Choose Your Database](#choose-your-database)
2. [PostgreSQL Installation (Recommended)](#postgresql-installation-recommended)
3. [MySQL Installation (Alternative)](#mysql-installation-alternative)
4. [Post-Installation Steps](#post-installation-steps)
5. [Firewall Configuration](#firewall-configuration)
6. [Client Workstation Setup](#client-workstation-setup)
7. [Backup and Maintenance](#backup-and-maintenance)
8. [Troubleshooting](#troubleshooting)

---

## Choose Your Database

| Feature | PostgreSQL | MySQL |
|---------|------------|-------|
| **Recommended** | ✅ Yes | No |
| JSON Support | Native JSONB | JSON type |
| Array Support | Native | Via JSON |
| Full-Text Search | Built-in | Built-in |
| Windows Support | Excellent | Excellent |
| Performance | Excellent | Good |

**Recommendation:** Use PostgreSQL for better JSON handling and array support.

---

## PostgreSQL Installation (Recommended)

### Step 1: Download PostgreSQL

1. Go to: https://www.postgresql.org/download/windows/
2. Click "Download the installer"
3. Download the latest version (PostgreSQL 16.x recommended)

### Step 2: Run the Installer

1. Run the downloaded `.exe` file as Administrator
2. Click **Next** through the welcome screen
3. **Installation Directory:** Accept default or choose custom location
4. **Select Components:**
   - ✅ PostgreSQL Server
   - ✅ pgAdmin 4 (GUI management tool)
   - ✅ Command Line Tools
   - ❌ Stack Builder (optional)
5. **Data Directory:** Accept default or choose custom location
6. **Password:** Set a strong password for the `postgres` superuser
   - **IMPORTANT:** Remember this password!
7. **Port:** Accept default `5432` (or change if needed)
8. **Locale:** Accept default
9. Click **Next** and then **Finish**

### Step 3: Create the ELN Database

Open **pgAdmin 4** or **SQL Shell (psql)**:

#### Using pgAdmin 4:
1. Open pgAdmin 4 from Start Menu
2. Connect to your server (enter postgres password)
3. Right-click "Databases" → "Create" → "Database"
4. Name: `eln_production`
5. Click "Save"

#### Using Command Line:
```powershell
# Open PowerShell as Administrator
psql -U postgres

# Enter your postgres password when prompted
# Then run these commands:

-- Create the database
CREATE DATABASE eln_production;

-- Create a dedicated user for ELN
CREATE USER eln_admin WITH PASSWORD 'your_secure_password_here';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE eln_production TO eln_admin;

-- Connect to the database and grant schema privileges
\c eln_production
GRANT ALL ON SCHEMA public TO eln_admin;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO eln_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO eln_admin;

-- Exit
\q
```

### Step 4: Configure Remote Access (Optional)

If client workstations will connect directly to the database:

1. Find `postgresql.conf`:
   ```
   C:\Program Files\PostgreSQL\16\data\postgresql.conf
   ```
2. Edit and find the line:
   ```
   #listen_addresses = 'localhost'
   ```
3. Change to:
   ```
   listen_addresses = '*'
   ```

4. Find `pg_hba.conf`:
   ```
   C:\Program Files\PostgreSQL\16\data\pg_hba.conf
   ```
5. Add this line at the end (replace with your network):
   ```
   host    eln_production    eln_admin    192.168.1.0/24    scram-sha-256
   ```

6. Restart PostgreSQL service:
   ```powershell
   Restart-Service postgresql-x64-16
   ```

---

## MySQL Installation (Alternative)

### Step 1: Download MySQL

1. Go to: https://dev.mysql.com/downloads/installer/
2. Download "MySQL Installer for Windows"
3. Choose the full installer (mysql-installer-community-X.X.X.msi)

### Step 2: Run the Installer

1. Run the downloaded `.msi` file as Administrator
2. Choose **Custom** setup type
3. Select these products:
   - ✅ MySQL Server 8.x
   - ✅ MySQL Workbench (GUI management tool)
   - ✅ MySQL Shell
4. Click **Next** and **Execute** to install

### Step 3: Configure MySQL Server

1. **Type and Networking:**
   - Config Type: Development Computer (for lab servers)
   - Or: Server Computer (for dedicated servers)
   - Port: 3306 (default)
   - ✅ Open Windows Firewall port

2. **Authentication Method:**
   - Choose "Use Strong Password Encryption" (recommended)

3. **Accounts and Roles:**
   - Set a strong root password
   - **IMPORTANT:** Remember this password!

4. **Windows Service:**
   - ✅ Configure MySQL Server as a Windows Service
   - Service Name: MySQL80
   - ✅ Start the MySQL Server at System Startup

5. Click **Execute** to apply configuration

### Step 4: Create the ELN Database

Open **MySQL Workbench** or **MySQL Shell**:

#### Using MySQL Workbench:
1. Open MySQL Workbench
2. Connect to your local instance
3. Run this SQL script:

```sql
-- Create the database
CREATE DATABASE eln_production CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Create a dedicated user
CREATE USER 'eln_admin'@'localhost' IDENTIFIED BY 'your_secure_password_here';

-- Grant privileges
GRANT ALL PRIVILEGES ON eln_production.* TO 'eln_admin'@'localhost';

-- For remote access (optional)
CREATE USER 'eln_admin'@'%' IDENTIFIED BY 'your_secure_password_here';
GRANT ALL PRIVILEGES ON eln_production.* TO 'eln_admin'@'%';

-- Apply changes
FLUSH PRIVILEGES;
```

#### Using Command Line:
```powershell
# Open PowerShell
mysql -u root -p

# Enter your root password when prompted
# Then run the SQL commands above
```

### Step 5: Configure Remote Access (Optional)

1. Find `my.ini`:
   ```
   C:\ProgramData\MySQL\MySQL Server 8.0\my.ini
   ```
2. Find the line:
   ```
   bind-address = 127.0.0.1
   ```
3. Change to:
   ```
   bind-address = 0.0.0.0
   ```
4. Restart MySQL service:
   ```powershell
   Restart-Service MySQL80
   ```

---

## Post-Installation Steps

### Step 1: Verify Database Connection

Test your database connection:

#### PostgreSQL:
```powershell
psql -h localhost -U eln_admin -d eln_production
# Enter password when prompted
# You should see: eln_production=>
```

#### MySQL:
```powershell
mysql -h localhost -u eln_admin -p eln_production
# Enter password when prompted
# You should see: mysql>
```

### Step 2: Run the Server Installation

```powershell
cd C:\path\to\ENotebook
.\installserver.bat
```

Follow the prompts and enter your database configuration.

### Step 3: Verify ELN Server

After installation, test the server:

```powershell
# Start the server
.\start-server.bat

# In another terminal, test the health endpoint
curl http://localhost:4000/health
```

Expected response:
```json
{"status":"ok","time":"2025-12-10T..."}
```

---

## Firewall Configuration

### Windows Firewall Rules

To allow client connections, create firewall rules:

```powershell
# Run PowerShell as Administrator

# For ELN Server API (port 4000)
New-NetFirewallRule -DisplayName "ELN Server" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow

# For PostgreSQL (if direct DB access needed)
New-NetFirewallRule -DisplayName "PostgreSQL" -Direction Inbound -Protocol TCP -LocalPort 5432 -Action Allow

# For MySQL (if direct DB access needed)
New-NetFirewallRule -DisplayName "MySQL" -Direction Inbound -Protocol TCP -LocalPort 3306 -Action Allow
```

### Network Discovery

For client workstations to find the server:

1. Open **Control Panel** → **Network and Sharing Center**
2. Click **Change advanced sharing settings**
3. Under your network profile, enable:
   - ✅ Turn on network discovery
   - ✅ Turn on file and printer sharing

---

## Client Workstation Setup

### Step 1: Install Local Client

On each lab workstation:

1. Copy the ENotebook folder or clone from Git
2. Run `installlocal.bat`

### Step 2: Configure Sync Server

Edit `apps/server/.env` on the client workstation:

```env
# Change these lines:
SYNC_SERVER_URL=http://SERVER_NAME_OR_IP:4000

# Example:
SYNC_SERVER_URL=http://192.168.1.100:4000
# or
SYNC_SERVER_URL=http://lab-server:4000
```

### Step 3: Test Sync

Run on the client:
```powershell
.\sync-now.bat
```

---

## Backup and Maintenance

### Automated Backups

#### PostgreSQL - Windows Task Scheduler:

1. Open **Task Scheduler**
2. Create Basic Task:
   - Name: "ELN Database Backup"
   - Trigger: Daily at 2:00 AM
   - Action: Start a program
   - Program: `C:\path\to\ENotebook\backup-database.bat`

#### MySQL - Windows Task Scheduler:

Same as above, using the `backup-database.bat` script.

### Manual Backup Commands

#### PostgreSQL:
```powershell
$env:PGPASSWORD = "your_password"
pg_dump -h localhost -U eln_admin -d eln_production -F c -f "backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').backup"
```

#### MySQL:
```powershell
mysqldump -h localhost -u eln_admin -p eln_production > "backup_$(Get-Date -Format 'yyyyMMdd_HHmmss').sql"
```

### Restore from Backup

#### PostgreSQL:
```powershell
$env:PGPASSWORD = "your_password"
pg_restore -h localhost -U eln_admin -d eln_production -c backup_file.backup
```

#### MySQL:
```powershell
mysql -h localhost -u eln_admin -p eln_production < backup_file.sql
```

---

## Troubleshooting

### Common Issues

#### "Connection refused" error

1. Check if database service is running:
   ```powershell
   # PostgreSQL
   Get-Service postgresql*
   
   # MySQL
   Get-Service MySQL*
   ```

2. Start the service if stopped:
   ```powershell
   Start-Service postgresql-x64-16  # or MySQL80
   ```

#### "Authentication failed" error

1. Verify username and password
2. Check `pg_hba.conf` (PostgreSQL) or user privileges (MySQL)
3. Try connecting locally first

#### "Database does not exist" error

1. Connect as superuser and create the database:
   ```sql
   CREATE DATABASE eln_production;
   ```

#### Port already in use

1. Find what's using the port:
   ```powershell
   netstat -ano | findstr :4000
   ```

2. Change the port in `.env` file

#### Prisma migration errors

1. Reset the database (WARNING: deletes all data):
   ```powershell
   cd apps/server
   npx prisma migrate reset
   ```

2. Or push schema without migrations:
   ```powershell
   npx prisma db push
   ```

### Getting Help

- Check logs in `data/logs/`
- Run `server-status.bat` to check server health
- View PM2 logs: `npx pm2 logs eln-server`

---

## Security Recommendations

1. **Change default passwords** immediately after installation
2. **Use strong passwords** (12+ characters, mixed case, numbers, symbols)
3. **Limit network access** - only allow necessary IP ranges
4. **Enable SSL/TLS** for database connections in production
5. **Regular backups** - test restore procedures periodically
6. **Keep software updated** - apply security patches promptly
7. **Monitor access logs** - review for suspicious activity

---

## Quick Reference

| Component | Default Port | Config File |
|-----------|--------------|-------------|
| ELN Server | 4000 | `apps/server/.env` |
| PostgreSQL | 5432 | `postgresql.conf`, `pg_hba.conf` |
| MySQL | 3306 | `my.ini` |

| Script | Purpose |
|--------|---------|
| `installserver.bat` | Initial server setup |
| `start-server.bat` | Start server (dev mode) |
| `start-server-pm2.bat` | Start server (production) |
| `stop-server.bat` | Stop server |
| `backup-database.bat` | Backup database |
| `restore-database.bat` | Restore from backup |
| `server-status.bat` | Check server health |
