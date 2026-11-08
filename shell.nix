let
  pkgs = import ./nix {};
in
  pkgs.mkShell {
    nativeBuildInputs = with pkgs; [
      coreutils
      git
      jq
      less
      niv
      nix-diff
      which
    ];

    shellHook = ''
      # Needed for macOS, since the TMPDIR path is long there
      export TMPDIR=/tmp

      # Aliases
      alias ls='ls --color'
      alias l='ls -la'
    '';
  }
