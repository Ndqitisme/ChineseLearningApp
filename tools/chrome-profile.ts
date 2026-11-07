// Chrome on Windows checks once per profile whether the OS password is blank by logging on with an
// empty password, and caches the answer in the profile's "Local State". Windows counts each check as
// a failed logon, so ten launches with fresh profiles within ten minutes lock the user's account.
// Fresh profiles therefore start with the answer saved by the previous run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SAVED = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'chrome-password-check.json');

/** A new, empty Chrome profile folder that already holds the saved answer, if there is one. */
export function freshProfile(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  if (fs.existsSync(SAVED)) fs.copyFileSync(SAVED, path.join(dir, 'Local State'));
  return dir;
}

/** Call after Chrome has closed: saves the profile's answer for the next fresh profile. */
export function saveProfileAnswer(dir: string): void {
  const file = path.join(dir, 'Local State');
  if (!fs.existsSync(file)) return;
  const answer = JSON.parse(fs.readFileSync(file, 'utf8')).password_manager;
  if (answer?.os_password_last_changed === undefined) return;
  fs.mkdirSync(path.dirname(SAVED), { recursive: true });
  fs.writeFileSync(SAVED, JSON.stringify({ password_manager: answer }));
}
