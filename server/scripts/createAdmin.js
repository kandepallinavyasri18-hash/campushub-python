#!/usr/bin/env node
/**
 * Creates the initial CampusHub admin account.
 *
 * Admin accounts are intentionally NOT available on the public registration
 * form, so this script (which runs on your machine with access to .env) is the
 * only way to create one. The password is hashed by the User model before it
 * is stored, and it is never printed to the console or written to the repo.
 *
 * Usage - interactive:
 *   npm run create-admin
 *
 * Usage - non-interactive (great for scripting/CI):
 *   npm run create-admin -- --name "Asha Rao" --email admin@college.edu --password "Str0ngPass!"
 *
 * Options:
 *   --name      full name of the administrator
 *   --email     login email (also read from ADMIN_EMAIL in .env)
 *   --password  login password (also read from ADMIN_PASSWORD in .env); min 8 chars
 *   --force     reset the name/password if that admin already exists
 *   --help      show this help
 */
const readline = require('readline');
const config = require('../config/config');
const { connectDB, disconnectDB } = require('../config/db');
const User = require('../models/User');
const { ROLES } = User;
const { isValidEmail, normalizeEmail } = require('../utils/validators');

const ADMIN_MIN_PASSWORD = 8;

function parseArgs(argv) {
  const args = { force: false, help: false };
  const list = argv.slice(2);

  for (let i = 0; i < list.length; i += 1) {
    const token = list[i];
    switch (token) {
      case '--force': args.force = true; break;
      case '--help':
      case '-h': args.help = true; break;
      case '--name': args.name = list[i + 1]; i += 1; break;
      case '--email': args.email = list[i + 1]; i += 1; break;
      case '--password': args.password = list[i + 1]; i += 1; break;
      default:
        if (token.startsWith('--name=')) { args.name = token.slice(7); }
        else if (token.startsWith('--email=')) { args.email = token.slice(8); }
        else if (token.startsWith('--password=')) { args.password = token.slice(11); }
    }
  }
  return args;
}

function printHelp() {
  console.log(`
CampusHub - create the initial admin account

  npm run create-admin -- --name "Full Name" --email admin@college.edu --password "Secret123"

  --name      administrator full name
  --email     administrator email
  --password  administrator password (minimum ${ADMIN_MIN_PASSWORD} characters)
  --force     update an existing admin with the same email
`);
}

function question(rl, query, options) {
  const hidden = Boolean(options && options.hidden);
  return new Promise((resolve) => {
    if (hidden) {
      // Mask typed characters with '*' so a shoulder-surfer cannot read it.
      rl.stdoutMuted = true;
      rl._writeToOutput = function writeMasked() { rl.output.write('*'); };
    }
    rl.question(query, (answer) => {
      if (hidden) {
        rl.stdoutMuted = false;
        delete rl._writeToOutput;
        rl.output.write('\n');
      }
      resolve(String(answer || '').trim());
    });
  });
}

async function collectAnswers(args) {
  const answers = {
    fullName: (args.name || '').trim(),
    email: normalizeEmail(args.email || ''),
    password: (args.password || '').trim()
  };

  if (answers.fullName && answers.email && answers.password) { return answers; }

  console.log('\nCreate the initial CampusHub administrator\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (!answers.fullName) {
      answers.fullName = await question(rl, 'Full name: ');
    }
    if (!answers.email) {
      answers.email = normalizeEmail(await question(rl, 'Email: '));
    }
    if (!answers.password) {
      answers.password = await question(rl, 'Password (typing is masked): ', { hidden: true });
    }
  } finally {
    rl.close();
  }

  return answers;
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    return 0;
  }

  config.assertConfig();

  // .env values act as defaults so `npm run create-admin` can be fully guided.
  if (!args.name) { args.name = config.admin.fullName; }
  if (!args.email) { args.email = config.admin.email; }
  if (!args.password) { args.password = config.admin.password; }

  const answers = await collectAnswers(args);

  /* ---- validation ---- */
  const problems = [];
  if (!answers.fullName || answers.fullName.length < 3) {
    problems.push('Full name must be at least 3 characters long.');
  }
  if (!isValidEmail(answers.email)) {
    problems.push('Email must be a valid address, for example admin@college.edu.');
  }
  if (!answers.password || answers.password.length < ADMIN_MIN_PASSWORD) {
    problems.push(`Admin password must be at least ${ADMIN_MIN_PASSWORD} characters long.`);
  }
  if (answers.password && answers.password.toLowerCase() === 'changethisadminpassword123') {
    problems.push('The password still has the example value from .env - choose a real one.');
  }

  if (problems.length) {
    console.error('\nCannot create the admin account:');
    problems.forEach((problem) => console.error('  - ' + problem));
    return 1;
  }

  await connectDB();

  try {
    const existing = await User.findOne({ email: answers.email }).select('+password');

    if (existing && existing.role !== ROLES.ADMIN) {
      console.error(
        `\nThe email ${answers.email} already belongs to a ${existing.role} account.` +
        '\nRefusing to change its role. Use a different email for the administrator.'
      );
      return 1;
    }

    if (existing && !args.force) {
      console.error(
        `\nAn admin with the email ${answers.email} already exists.` +
        '\nRe-run with --force to update the name and password.'
      );
      return 1;
    }

    if (existing && args.force) {
      existing.fullName = answers.fullName;
      existing.password = answers.password; // re-hashed by the pre-save hook
      await existing.save();
      console.log(`\n[admin] updated the existing admin account for ${existing.email}`);
      console.log('[admin] the password was re-hashed and stored securely.');
      return 0;
    }

    const admin = await User.create({
      fullName: answers.fullName,
      email: answers.email,
      password: answers.password,
      role: ROLES.ADMIN
    });

    console.log('\n[admin] admin account created successfully');
    console.log(`         name  : ${admin.fullName}`);
    console.log(`         email : ${admin.email}`);
    console.log(`         role  : ${admin.role}`);
    console.log(`         id    : ${admin.id}`);
    console.log(`\nLog in at http://localhost:${config.port}/login.html`);
    console.log('(the password is never printed and never stored in plain text)');
    return 0;
  } finally {
    await disconnectDB();
  }
}

main()
  .then((code) => process.exit(code))
  .catch(async (error) => {
    console.error('\n[admin] failed');
    console.error(error.message);
    try { await disconnectDB(); } catch (ignored) { /* already closed */ }
    process.exit(1);
  });

