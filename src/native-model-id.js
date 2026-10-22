const validModel = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:\[\]-]{0,99}$/.test(value);
module.exports = { validModel };
