# OpenSpec shell completions configuration
fpath=("/Users/chlorinec/.oh-my-zsh/custom/completions" $fpath)

# ===== 统一 PATH 配置 =====
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$HOME/.deno/bin:$HOME/.antigravity/antigravity/bin:$HOME/.console-ninja/.bin:$PATH"

# ===== Oh My Zsh 配置 =====
export ZSH="$HOME/.oh-my-zsh"
ZSH_THEME="robbyrussell"
plugins=(git aliases zsh-syntax-highlighting zsh-autosuggestions zsh-osx-autoproxy pnpm)
source $ZSH/oh-my-zsh.sh

# ===== 用户配置 =====
export MANPATH="/usr/local/man:$MANPATH"
export LANG=en_US.UTF-8

if [[ -n $SSH_CONNECTION ]]; then
  export EDITOR='vim'
else
  export EDITOR='nvim'
fi

# ===== fnm (Fast Node Manager) =====
eval "$(fnm env --use-on-cd --shell zsh)"

# ===== Bun =====
export BUN_INSTALL="$HOME/.bun"

# ===== pnpm =====
export PNPM_HOME="/Users/chlorinec/Library/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac

# ===== deno =====
. "/Users/chlorinec/.deno/env"

# ===== mamba/micromamba =====
export MAMBA_EXE='/opt/homebrew/bin/micromamba';
export MAMBA_ROOT_PREFIX='/Users/chlorinec/micromamba';
__mamba_setup="$("$MAMBA_EXE" shell hook --shell zsh --root-prefix "$MAMBA_ROOT_PREFIX" 2> /dev/null)"
if [ $? -eq 0 ]; then
    eval "$__mamba_setup"
else
    alias micromamba="$MAMBA_EXE"
fi
unset __mamba_setup

# ===== bun completions =====
[ -s "/Users/chlorinec/.bun/_bun" ] && source "/Users/chlorinec/.bun/_bun"

# ===== local env =====
. "$HOME/.local/bin/env"

# ===== thefuck (延迟加载) =====
fuck() {
  unset -f fuck
  eval $(thefuck --alias)
  fuck "$@"
}

# ===== Codeium/Windsurf =====
export PATH="/Users/chlorinec/.codeium/windsurf/bin:$PATH"

# ===== x-cmd =====
[ ! -f "$HOME/.x-cmd.root/X" ] || . "$HOME/.x-cmd.root/X"

# ===== Antigravity =====
export PATH="/Users/chlorinec/.antigravity/antigravity/bin:$PATH"

# ===== opencode =====
export PATH=/Users/chlorinec/.opencode/bin:$PATH
alias atg='antigravity'

# ===== zoxide =====
eval "$(zoxide init zsh)"

# ===== Mole shell completion =====
if output="$(mole completion zsh 2>/dev/null)"; then eval "$output"; fi

# ===== Google Cloud =====
export GOOGLE_CLOUD_PROJECT="active-venture-465808-u5"
export NO_PROXY=localhost,127.0.0.1

# ===== 性能优化: zcompile =====
if [[ ! ~/.zshrc.zwc -nt ~/.zshrc ]]; then
  zcompile ~/.zshrc
fi
