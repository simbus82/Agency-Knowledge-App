function isAdminRequest(req){
  try {
    if(req.session && req.session.user && process.env.ADMIN_EMAIL){
      return req.session.user.email === process.env.ADMIN_EMAIL;
    }
    if(req.session && req.session.user && process.env.ALLOWED_DOMAIN){
      const domain = req.session.user.email.split('@').pop();
      return domain === process.env.ALLOWED_DOMAIN;
    }
  } catch(_){}
  return false;
}

module.exports = { isAdminRequest };

