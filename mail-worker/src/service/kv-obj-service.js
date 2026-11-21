async function readPrefix(stream,limit) {
  const reader=stream.getReader(),bytes=new Uint8Array(limit);
  let length=0;
  try {
    while (length<limit) {
      const {value,done}=await reader.read();
      if (done) break;
      const part=value.subarray(0,limit-length);
      bytes.set(part,length);
      length+=part.length;
    }
    return bytes.subarray(0,length);
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

const kvObjService = {

	async putObj(c, key, content, metadata) {
		await c.env.kv.put(key, content, { metadata: metadata });
	},

	async deleteObj(c, keys) {

		if (typeof keys === 'string') {
			keys = [keys];
		}

		if (keys.length === 0) {
			return;
		}

		await Promise.all(keys.map( key => c.env.kv.delete(key)));
	},

	async getObj(c, key, prefixBytes) {
		const obj = await c.env.kv.getWithMetadata(key, { type: prefixBytes ? "stream" : "arrayBuffer"});
		if (!obj.value) {
			return null;
		}

		return new Response(prefixBytes ? await readPrefix(obj.value,prefixBytes) : obj.value, {
			headers: {
				'Content-Type': obj.metadata?.contentType || 'application/octet-stream',
				'Content-Disposition': obj.metadata?.contentDisposition || null,
				'Cache-Control': obj.metadata?.cacheControl || null
			}
		});
	},

	async toObjResp(c, key) {

		return await this.getObj(c, key);

	}

};

export default kvObjService;
