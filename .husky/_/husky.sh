#!/usr/bin/env sh
if [ -z "$husky_skip_init" ]; then
  debug () {
    [ "$HUSKY_DEBUG" = "1" ] && echo "husky (debug) - $1"
  }

  readonly husky_skip_init=1
  export husky_skip_init

  debug "starting..."
  if [ -f ~/.huskyrc ]; then
    debug "~/.huskyrc found, sourcing..."
    . ~/.huskyrc
  fi

  export PATH="$PATH:.git/hooks/node_modules/.bin"
  debug "PATH=$PATH"
fi