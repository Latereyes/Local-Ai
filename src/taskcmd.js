// Comandi dei task automatici della coda: quali possono girare senza conferma nella cartella del progetto
// (libro mindfulness 2026-10-12: senza comandi i task non potevano eseguire gli script che scrivevano)
export const TASK_COMMANDS_HELP = 'python script.py, python -m unittest, pytest, node script.js, node --test, npm test, npm run <nome>, pip install <pacchetti>, npm install <pacchetti>';

// Normalizza il nome eseguibile (minuscolo, senza .exe)
function baseName(cmd) {
  const n = cmd.toLowerCase();
  return n.endsWith('.exe') ? n.slice(0, -4) : n;
}

// Verifica che un argomento non sia un percorso assoluto o contenga ".."
function isSafePath(arg) {
  if (arg.startsWith('-')) return true;
  if (arg.startsWith('/') || arg.startsWith('\\')) return false;
  if (/^[A-Za-z]:[\\/]/.test(arg)) return false;
  if (arg.includes('..')) return false;
  return true;
}

// Verifica che un pacchetto npm/pip sia valido
const PKG_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*([<>=!~]=?[0-9][0-9.]*)?$/;
function isSafePkg(arg) {
  return PKG_RE.test(arg);
}

// Verifica che un percorso script abbia estensione corretta
function hasExt(arg, exts) {
  const lower = arg.toLowerCase();
  return exts.some(e => lower.endsWith(e));
}

export function taskCommand(command) {
  // Controllo lunghezza e caratteri vietati
  if (!command || command.length > 300) return { ok: false, reason: 'comando vuoto o troppo lungo' };
  if (/[\u0000-\u001F\u007F]|&|\||<|>|\^|;|`|\$|%|\(|\)/.test(command)) return { ok: false, reason: 'caratteri non ammessi' };

  // Tokenizza preservando gli spazi interni (semplice split su spazi)
  const tokens = command.trim().split(/\s+/);
  if (tokens.length === 0) return { ok: false, reason: 'comando vuoto' };

  const exe = baseName(tokens[0]);
  const args = tokens.slice(1);

  // Verifica generale: nessun argomento è un percorso non sicuro
  for (const a of args) {
    if (!isSafePath(a)) return { ok: false, reason: 'percorso non sicuro' };
  }

  // --- Python / Pytest ---
  if (['python', 'python3', 'py'].includes(exe)) {
    // pip install
    if (args[0] === '-m' && args[1] === 'pip') {
      const rest = args.slice(2);
      if (rest[0] === 'install') {
        const pkgs = rest.slice(1);
        if (pkgs.length === 0) return { ok: false, reason: 'almeno un pacchetto richiesto' };
        for (const p of pkgs) {
          if (p.startsWith('-')) return { ok: false, reason: 'opzioni non ammesse in install' };
          if (!isSafePkg(p)) return { ok: false, reason: 'nome pacchetto non valido' };
        }
        return { ok: true, kind: 'install', lang: 'python', packages: pkgs };
      }
      return { ok: false, reason: 'sottocomando pip non ammesso' };
    }
    // unittest
    if (args[0] === '-m' && args[1] === 'unittest') {
      return { ok: true, kind: 'run' };
    }
    // pytest
    if (args[0] === '-m' && args[1] === 'pytest') {
      return { ok: true, kind: 'run' };
    }
    // script diretto
    if (args.length >= 1 && !args[0].startsWith('-')) {
      if (hasExt(args[0], ['.py'])) {
        return { ok: true, kind: 'run' };
      }
    }
    return { ok: false, reason: 'formato python non ammesso' };
  }

  // --- pip install diretto ---
  if (exe === 'pip' || exe === 'pip3') {
    if (args[0] !== 'install') return { ok: false, reason: 'sottocomando pip non ammesso' };
    const pkgs = args.slice(1);
    if (pkgs.length === 0) return { ok: false, reason: 'almeno un pacchetto richiesto' };
    for (const p of pkgs) {
      if (p.startsWith('-')) return { ok: false, reason: 'opzioni non ammesse in install' };
      if (!isSafePkg(p)) return { ok: false, reason: 'nome pacchetto non valido' };
    }
    return { ok: true, kind: 'install', lang: 'python', packages: pkgs };
  }

  // --- Pytest diretto ---
  if (exe === 'pytest') {
    return { ok: true, kind: 'run' };
  }

  // --- Node ---
  if (exe === 'node') {
    // node --test
    if (args[0] === '--test') {
      return { ok: true, kind: 'run' };
    }
    // node script.js
    if (args.length >= 1 && !args[0].startsWith('-')) {
      if (hasExt(args[0], ['.js', '.mjs', '.cjs'])) {
        return { ok: true, kind: 'run' };
      }
    }
    return { ok: false, reason: 'formato node non ammesso' };
  }

  // --- NPM ---
  if (exe === 'npm') {
    const sub = args[0];
    // npm test
    if (sub === 'test') {
      return { ok: true, kind: 'run' };
    }
    // npm run <name>
    if (sub === 'run') {
      if (args.length < 2) return { ok: false, reason: 'nome script mancante' };
      return { ok: true, kind: 'run' };
    }
    // npm install / npm i
    if (sub === 'install' || sub === 'i') {
      const pkgs = args.slice(1);
      if (pkgs.length === 0) return { ok: false, reason: 'almeno un pacchetto richiesto' };
      for (const p of pkgs) {
        if (p.startsWith('-')) return { ok: false, reason: 'opzioni non ammesse in install' };
        if (!isSafePkg(p)) return { ok: false, reason: 'nome pacchetto non valido' };
      }
      return { ok: true, kind: 'install', lang: 'js', packages: pkgs };
    }
    return { ok: false, reason: 'sottocomando npm non ammesso' };
  }

  return { ok: false, reason: 'comando non riconosciuto' };
}
