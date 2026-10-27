# Memory

[← Docs](README.md) · [中文](../memory.md)

- The model records lasting facts on its own during chats (preferences, identity, project conventions, conclusions that will be useful later), one sentence per entry, readable across chats. The **Memory** tab in settings lets you edit, delete and add entries by hand, or turn memory off entirely
- Memory isn't sent with every request: the system prompt only tells the model that the memory exists and when to write or look. Entries are seen only through `recall`, and old chats are found with `search_conversations` and read with `read_conversation` — so a new topic isn't disturbed by the past
- Consolidation: `remember` with `replaces` merges similar entries into one, and `forget` deletes outdated ones. The limit is 324 entries; when full, the model is told to clean up first
- All five tools run in the browser, without the bridge and without approval, and every step is visible in **Steps**. Memories consulted and past chats found or read are listed under **Sources** at the bottom of the reply, each opening where it belongs. Entries are included in backup export, and deduplicated by id and text on import
