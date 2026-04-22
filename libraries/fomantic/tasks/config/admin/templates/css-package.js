var
  where = 'client' // Adds files only to the client
;

Package.describe({
  name    : 'semantic:ui-css',
  summary : 'Semantic UI - CSS Release of Semantic UI',
  version : '{version}',
  git     : 'git://github.com/Semantic-Org/Semantic-UI-CSS.git',
});

Package.onUse(function(api) {

  api.versionsFrom('1.0');

  api.use('jquery', 'client');

  api.addFiles([
    // icons
    'themes/fabric/assets/fonts/icons.eot',
    'themes/fabric/assets/fonts/icons.svg',
    'themes/fabric/assets/fonts/icons.ttf',
    'themes/fabric/assets/fonts/icons.woff',
    'themes/fabric/assets/fonts/icons.woff2',

    // flags
    'themes/fabric/assets/images/flags.png',

    // release
    'semantic.css',
    'semantic.js'
  ], 'client');

});
