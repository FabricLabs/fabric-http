module.exports = function hasRole (role) {
  if (this.identity) {
    console.debug('[!!!] Identity start:', this.identity);
    console.debug('[!!!] Checking for role:', role);
    console.debug('[!!!] Authorization:', this.headers['authorization']);
  }

  return false;
}
