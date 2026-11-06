import { randomBytes, scrypt } from 'node:crypto';
import { stdin, stdout, stderr } from 'node:process';

// No password arguments or environment variables: they can leak into shell history.
async function readPassword() {
  if (!stdin.isTTY) {
    let input = '';
    for await (const chunk of stdin) {
      input += chunk;
      if (input.length > 1024) throw new Error('Entrada demasiado larga.');
    }
    return input.replace(/\r?\n$/, '');
  }
  stderr.write('Nueva contraseña del panel (mínimo 16 caracteres, entrada oculta): ');
  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();
  return new Promise((resolve, reject) => {
    let password = '';
    const finish = (error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', onData);
      stderr.write('\n');
      error ? reject(error) : resolve(password);
    };
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\u0003') { finish(new Error('Cancelado.')); return; }
        if (character === '\r' || character === '\n') { finish(); return; }
        if (character === '\u007f' || character === '\b') password = password.slice(0, -1);
        else if (character >= ' ') password += character;
        if (password.length > 256) { finish(new Error('Máximo 256 caracteres.')); return; }
      }
    };
    stdin.on('data', onData);
  });
}

try {
  const password = await readPassword();
  if (password.length < 16 || password.length > 256) throw new Error('Usa una contraseña única de 16 a 256 caracteres.');
  const salt = randomBytes(16);
  const hash = await new Promise((resolve, reject) => {
    scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
      (error, result) => error ? reject(error) : resolve(result));
  });
  stdout.write(`scrypt:131072:8:1:${salt.toString('hex')}:${hash.toString('hex')}\n`);
} catch (error) {
  stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
