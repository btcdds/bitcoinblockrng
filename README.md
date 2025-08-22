# Bitcoin Block RNG

Welcome! This project is a simple, transparent way to generate random numbers using the Bitcoin blockchain.

## Why use Bitcoin blocks for randomness?

Bitcoin blocks are created roughly every 10 minutes, and each block includes a unique cryptographic hash. That hash is unpredictable ahead of time and can be verified by anyone after it is published. This makes it a solid source of randomness that doesn’t rely on trusting a single website, company, or person.

By using block hashes, you get:
- **Transparency** – Everyone can see the block hash directly from the Bitcoin network.
- **Fairness** – Nobody can know the result before the block is mined.
- **Verifiability** – Anyone can double‑check the process and confirm the random number was generated honestly.

## How to use the site

1. **Start at the landing page** – You’ll see a short explanation and a button to go to the generator.
2. **Set your options** – Choose:
   - How many random numbers you want (up to 10).
   - The range (for example, 1–100).
   - How many consecutive blocks to wait for (up to 5). Using more blocks adds more randomness, but it takes longer.
   - Which blockchain data provider to use (mempool.space or blockstream.info).
3. **(Optional) Public timestamp** – You can choose to publish a commitment on Nostr before the block is mined. This proves you didn’t change your selection after seeing the results.
4. **Begin** – Click the Begin button. The site will wait for the next block (or blocks, if you selected more than one). You’ll see an estimated time and how long it has been since the last block.
5. **See your results** – Once the block(s) are mined, the site shows:
   - The block hashes used
   - The random numbers generated
   - A short proof (easy to share on social media)
   - A long proof (complete details)
6. **Verify** – Anyone can paste a short proof back into the site and check that it is valid.

## Things to keep in mind

- **Not for high‑stakes use** – While block hashes are unpredictable, miners technically have a small ability to withhold blocks. For casual use like games, raffles, or fun random picks, it’s excellent. But don’t use this to decide something like million‑dollar lotteries or secure cryptography.
- **Delays happen** – Sometimes blocks come quickly, other times they take longer. Expect around 10 minutes per block on average.
- **No personal data** – The site doesn’t track you or collect private information.

## Supporting the project

If you enjoy the site and want to support it, you can send a small Lightning tip by scanning the QR code on the generator or results page. Even a few sats are appreciated!

## Questions or issues

- Contact: [Nostr npub](https://snort.social/p/npub177wsn56w3dzvmkut9v0vt9larwckmctuvyvmx8qvqd2ywa6hup7svt2042)
- Report issues: [GitHub Issues](https://github.com/btcdds/bitcoinblockrng/issues)

