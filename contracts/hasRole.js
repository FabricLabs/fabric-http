module.exports = function hasRole (role) {
  if (!role) return false;

  const payload = this.tokenPayload || {};
  if (payload.role && payload.role === role) return true;

  if (Array.isArray(payload.roles) && payload.roles.includes(role)) {
    return true;
  }

  return false;
}
