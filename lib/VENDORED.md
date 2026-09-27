# Vendored dependencies

Plain copies (no git metadata, no submodules) so the offline verifier can build without a network.
Only `src/` (plus the `test/utils/CurrencySettler.sol` helper that v4-core's router test contracts
import) and licences are kept.

| Library       | Upstream                                     | Commit                                     |
| ------------- | -------------------------------------------- | ------------------------------------------ |
| v4-core       | https://github.com/Uniswap/v4-core           | `59d3ecf53afa9264a16bba0e38f4c5d2231f80bc` |
| v4-periphery  | https://github.com/Uniswap/v4-periphery      | `3779387e5d296f39df543d23524b050f89a62917` (last commit shipping `src/utils/BaseHook.sol`; it pins the v4-core commit above) |
| forge-std     | https://github.com/foundry-rs/forge-std      | `1de6eecf821de7fe2c908cc48d3ab3dced20717f` (v1.9.3, the commit v4-core pins) |
| solmate       | https://github.com/transmissions11/solmate   | `4b47a19038b798b4a33d9749d25e570443520647` (the commit v4-core pins) |
