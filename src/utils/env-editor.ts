import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env');

export function updateEnvFile(key: string, value: string) {
  let envContent = '';
  try {
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf-8');
    }
  } catch (e) {
    console.error('Error reading .env file', e);
  }

  const lines = envContent.split('\n');
  let found = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`${key}=`)) {
      lines[i] = `${key}=${value}`;
      found = true;
      break;
    }
  }

  if (!found) {
    if (lines.length > 0 && lines[lines.length - 1] !== '') {
      lines.push('');
    }
    lines.push(`${key}=${value}`);
  }

  fs.writeFileSync(envPath, lines.join('\n'), 'utf-8');
  process.env[key] = value;
}

export function getAdminTgIds(): string[] {
  const idsStr = process.env.ADMIN_TG_IDS || '8413696128';
  return idsStr.split(',').map(id => id.trim()).filter(id => id);
}

export function addAdminTgId(id: string): boolean {
  const ids = getAdminTgIds();
  if (ids.includes(id)) return false;
  ids.push(id);
  updateEnvFile('ADMIN_TG_IDS', ids.join(','));
  return true;
}

export function removeAdminTgId(id: string): boolean {
  let ids = getAdminTgIds();
  if (!ids.includes(id)) return false;
  // Protect default admin from being deleted if necessary?
  // User didn't request this explicitly, but it's good practice, or just let them delete anyone. Let's let them delete anyone.
  ids = ids.filter(existing => existing !== id);
  updateEnvFile('ADMIN_TG_IDS', ids.join(','));
  return true;
}
