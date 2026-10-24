# Presets

[← Docs](README.md) · [中文](../presets.md)

A preset bundles a way of working into one: a prompt, which tool groups to give (web, compute, commands and files, documents, asking the user, memory and past chats, subagents) and which MCP servers, which model, and the command permission level. Building a specialized agent on top of Yan — connecting a project's MCP and writing a dedicated prompt — is just adding a preset.

- Add, edit and delete presets in **Settings → Presets**, one card each; changes save immediately. If all tools and MCP servers are ticked, it's saved as "give everything", so groups and servers added later are included too.
- Choose one from the model menu next to the input box: chats with it selected follow that set, and the model button shows the preset's name; new chats use whatever you chose last. Choosing none gives plain Yan.
- The preset's prompt goes first in the system prompt, followed by Yan's own sections. Only the chosen tool groups are given to the model; an MCP server that isn't chosen won't run even if the model calls it by name. Presets with a model or permission level switch to them when selected.
