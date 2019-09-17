Bosco Roadmap

- Remove asset minification in current form and just have it programmatically drive webpack (or do nothing?)
  - If we can make this work does it give us live reload and other features that we're after?
  - Can this be done in a way that isn't massively impactful across old services?

- Refactor commonality (where possible?) out of commands and allow those parts to be more easily tested.

# bosco-core:
bosco object but no plugins.
Includes the function reading the command line.

# bosco:
it has the cli.
it reads the command line, create a bosco instance. Loads available plugins
deps:
bosco-core
bosco-plugin-*

# bosco-plugin-*
* bosco command implementation
* implements command line code for running this command in isolation (depends on bosco-core)
