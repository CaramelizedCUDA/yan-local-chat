import { crc32, deflateRawSync } from "node:zlib";

// OOXML 回归样本用的小 ZIP 写入器；不是产品代码，条目可用真实 deflate 压缩。
export function officeZip(files, compressed = false) {
  const locals = [],
    centrals = [];
  let offset = 0;
  for (const [name, value] of Object.entries(files)) {
    const data = Buffer.from(value),
      label = Buffer.from(name),
      packed = compressed ? deflateRawSync(data) : data,
      local = Buffer.alloc(30),
      central = Buffer.alloc(46),
      crc = crc32(data),
      method = compressed ? 8 : 0;
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(label.length, 26);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(label.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, label, packed);
    centrals.push(central, label);
    offset += 30 + label.length + packed.length;
  }
  const directory = Buffer.concat(centrals),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
