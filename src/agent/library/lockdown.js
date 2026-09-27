import 'ses';

// This sets up the secure environment
// We disable some of the taming to allow for more flexibility

// For configuration, see https://github.com/endojs/endo/blob/master/packages/ses/docs/lockdown.md

let lockeddown = false;
let lockdownDone = false;
export function lockdown() {
  if (lockeddown) return;
  lockeddown = true;
  // Call the SES global explicitly. Inside this module the bare name `lockdown`
  // is this exported function, so calling it here would never lock anything down.
  globalThis.lockdown({
    // basic devex and quality of life improvements
    localeTaming: 'unsafe',
    consoleTaming: 'unsafe',
    errorTaming: 'unsafe',
    stackFiltering: 'verbose',
    // allow eval outside of created compartments
    // (mineflayer dep "protodef" uses eval)
    evalTaming: 'unsafeEval',
    // no SES process handlers: its uncaught exception handler exits with -1,
    // which the parent process treats as "stop everything", and its rejection
    // handler only logs. installErrorReporting() handles both instead.
    errorTrapping: 'none',
    unhandledRejectionTrapping: 'none',
  });
  lockdownDone = true;
  installErrorReporting();
}

// true once SES lockdown has run in this process
export function isLockedDown() {
  return lockdownDone;
}

// levels of `cause` that formatError follows
const MAX_CAUSE_DEPTH = 3;

function isErrorValue(value) {
  try {
    if (value instanceof Error) return true;
  } catch {
    // a proxy can throw from its getPrototypeOf trap
  }
  try {
    return Object.prototype.toString.call(value) === '[object Error]';
  } catch {
    return false;
  }
}

function safeString(value) {
  try {
    return String(value);
  } catch {
    return '[unprintable value]';
  }
}

function readProperty(value, key) {
  try {
    return value[key];
  } catch {
    return undefined;
  }
}

function formatErrorAt(value, depth) {
  if (!isErrorValue(value)) return safeString(value);
  const stack = readProperty(value, 'stack');
  let text = typeof stack === 'string' && stack !== '' ? stack : safeString(value);
  const cause = readProperty(value, 'cause');
  if (cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    text += '\nCaused by: ' + formatErrorAt(cause, depth + 1);
  }
  return text;
}

// Readable text for any value, without side effects and without throwing.
// After lockdown Node prints error objects as {}, so errors become their stack
// (or String(error)) plus up to 3 levels of `cause`.
export function formatError(value) {
  return formatErrorAt(value, 0);
}

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'];
let errorReportingInstalled = false;

function wrapConsoleMethod(name, original) {
  // method syntax keeps the name and makes the wrapper non-constructible
  return {
    [name](...args) {
      const isError = args.map((arg) => isErrorValue(arg));
      const printable = args.map((arg, i) => (isError[i] ? formatError(arg) : arg));
      // Node reads the first argument as a format string when more follow. An
      // error there is now plain text, so '%s' in front keeps a '%' in it literal.
      if (isError[0]) printable.unshift('%s');
      return Reflect.apply(original, this, printable);
    },
  }[name];
}

function reportFatal(prefix, value) {
  try {
    process.stderr.write(`${prefix}${formatError(value)}\n`);
  } catch {
    // nothing left to report to, exit anyway
  }
  process.exit(1);
}

// Called by lockdown() once SES lockdown has succeeded. Makes errors readable
// in the console again and restores Node's "report and exit with 1" behaviour
// for uncaught exceptions and unhandled rejections. Idempotent.
export function installErrorReporting() {
  if (errorReportingInstalled) return;
  errorReportingInstalled = true;
  for (const name of CONSOLE_METHODS) {
    const original = console[name];
    if (typeof original === 'function') {
      console[name] = wrapConsoleMethod(name, original);
    }
  }
  process.on('uncaughtException', (error) => reportFatal('Uncaught exception: ', error));
  process.on('unhandledRejection', (reason) => reportFatal('Unhandled rejection: ', reason));
}

let sandboxLogged = false;

// only the first initSandbox call of the process logs
function logSandboxOnce(line) {
  if (sandboxLogged) return;
  sandboxLogged = true;
  console.log(line);
}

// Locks down the realm when the model may write code (allow_insecure_coding),
// unless settings.sandbox_lockdown is explicitly false. Safe to call many times,
// and a later call never undoes a lockdown. Returns isLockedDown() when lockdown
// was requested, false otherwise. Errors from the SES lockdown propagate.
export function initSandbox(settings) {
  const allowCoding = Boolean(settings?.allow_insecure_coding);
  if (!allowCoding || settings?.sandbox_lockdown === false) {
    const reason = allowCoding ? 'sandbox_lockdown is false' : 'allow_insecure_coding is off';
    logSandboxOnce(isLockedDown()
      ? `Sandbox: SES lockdown not requested (${reason}), but it is already active in this process.`
      : `Sandbox: SES lockdown not applied (${reason}).`);
    return false;
  }
  try {
    lockdown();
  } catch (err) {
    logSandboxOnce(`Sandbox: SES lockdown failed (${formatError(err).split('\n')[0]}).`);
    throw err;
  }
  const active = isLockedDown();
  logSandboxOnce(active
    ? 'Sandbox: SES lockdown active, code written by the model runs in an isolated compartment.'
    : 'Sandbox: SES lockdown not active, an earlier lockdown attempt failed.');
  return active;
}

export const makeCompartment = (endowments = {}) => {
  return new Compartment({
    // provide untamed Math, Date, etc
    Math,
    Date,
    // standard endowments
    ...endowments
  });
}