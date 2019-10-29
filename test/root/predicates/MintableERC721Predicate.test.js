import ethUtils from 'ethereumjs-util'
import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'

import deployer from '../../helpers/deployer.js'
import logDecoder from '../../helpers/log-decoder.js'
import { buildInFlight } from '../../mockResponses/utils'
import StatefulUtils from '../../helpers/StatefulUtils'

const predicateTestUtils = require('./predicateTestUtils')
const crypto = require('crypto')
const utils = require('../../helpers/utils')
const web3Child = utils.web3Child

chai.use(chaiAsPromised).should()
let contracts, childContracts
let predicate, statefulUtils

contract('MintableERC721Predicate.test', async function(accounts) {
  let tokenId
  const alice = accounts[0]
  const bob = accounts[1]

  before(async function() {
    contracts = await deployer.freshDeploy()
    predicate = await deployer.deployMintableErc721Predicate()
    childContracts = await deployer.initializeChildChain(accounts[0])
    statefulUtils = new StatefulUtils()
  })

  beforeEach(async function() {
    const { rootERC721, childErc721 } = await deployer.deployChildErc721Mintable()
    // add ERC721Predicate as a minter
    await rootERC721.addMinter(predicate.address)
    childContracts.rootERC721 = rootERC721
    childContracts.childErc721 = childErc721
    tokenId = '0x' + crypto.randomBytes(32).toString('hex')
  })

  it('mint and startExitWithMintedAndBurntTokens', async function() {
    const { receipt: r } = await childContracts.childErc721.mint(alice, tokenId)
    await utils.writeToFile('child/erc721-mint.js', r)
    let mintTx = await web3Child.eth.getTransaction(r.transactionHash)
    mintTx = await buildInFlight(mintTx)
    await childContracts.childErc721.transferFrom(alice, bob, tokenId)

    const { receipt } = await childContracts.childErc721.withdraw(tokenId, { from: bob })
    // the token doesnt exist on the root chain as yet
    // expect(await childContracts.rootERC721.exists(tokenId)).to.be.false

    let { block, blockProof, headerNumber, reference } = await statefulUtils.submitCheckpoint(contracts.rootChain, receipt, accounts)
    const startExitTx = await startExitWithBurntMintableToken(
      { headerNumber, blockProof, blockNumber: block.number, blockTimestamp: block.timestamp, reference, logIndex: 1 },
      mintTx,
      bob // exitor - account to initiate the exit from
    )
    console.log(startExitTx)
    // expect(await childContracts.rootERC721.exists(tokenId)).to.be.true
    expect((await childContracts.rootERC721.ownerOf(tokenId)).toLowerCase()).to.equal(contracts.depositManager.address.toLowerCase())

    const logs = logDecoder.decodeLogs(startExitTx.receipt.rawLogs)
    const log = logs[1]
    log.event.should.equal('ExitStarted')
    expect(log.args).to.include({
      exitor: bob,
      token: childContracts.rootERC721.address,
      isRegularExit: true
    })
    utils.assertBigNumberEquality(log.args.amount, tokenId)
  })

  it('mintWithTokenURI and startExitWithBurntTokens', async function() {
    const { receipt: r } = await childContracts.childErc721.mintWithTokenURI(alice, tokenId, `https://tokens.com/${tokenId}`)
    await utils.writeToFile('child/erc721-mintWithTokenURI.js', r)
    let mintTx = await web3Child.eth.getTransaction(r.transactionHash)
    mintTx = await buildInFlight(mintTx)
    // await childContracts.childErc721.transferFrom(alice, bob, tokenId)

    // const { receipt } = await childContracts.childErc721.withdraw(tokenId, { from: bob })
    // // the token doesnt exist on the root chain as yet
    // expect(await childContracts.rootERC721.exists(tokenId)).to.be.false

    // let { block, blockProof, headerNumber, reference } = await statefulUtils.submitCheckpoint(contracts.rootChain, receipt, accounts)
    // const startExitTx = await startExitWithBurntMintableToken(
    //   { headerNumber, blockProof, blockNumber: block.number, blockTimestamp: block.timestamp, reference, logIndex: 1 },
    //   mintTx,
    //   bob // exitor - account to initiate the exit from
    // )
    // // console.log(startExitTx)
    // expect(await childContracts.rootERC721.exists(tokenId)).to.be.true
    // expect((await childContracts.rootERC721.ownerOf(tokenId)).toLowerCase()).to.equal(contracts.depositManager.address.toLowerCase())

    // const logs = logDecoder.decodeLogs(startExitTx.receipt.rawLogs)
    // const log = logs[1]
    // log.event.should.equal('ExitStarted')
    // expect(log.args).to.include({
    //   exitor: bob,
    //   token: childContracts.rootERC721.address,
    //   isRegularExit: true
    // })
    // utils.assertBigNumberEquality(log.args.amount, tokenId)
  })

  it('mint, MoreVP exit with reference: counterparty balance (Transfer) and exitTx: incomingTransfer', async function() {
    const { receipt: mint } = await childContracts.childErc721.mint(alice, tokenId)
    const mintTx = await buildInFlight(await web3Child.eth.getTransaction(mint.transactionHash))

    // proof of counterparty's balance
    const { receipt } = await childContracts.childErc721.transferFrom(alice, bob, tokenId)
    const { block, blockProof, headerNumber, reference } = await statefulUtils.submitCheckpoint(contracts.rootChain, receipt, accounts)

    // treating this as in-flight incomingTransfer
    const { receipt: r } = await childContracts.childErc721.transferFrom(bob, alice, tokenId, { from: bob })
    let exitTx = await buildInFlight(await web3Child.eth.getTransaction(r.transactionHash))

    // the token doesnt exist on the root chain as yet
    // expect(await childContracts.rootERC721.exists(tokenId)).to.be.false

    const startExitTx = await startMoreVpExitWithMintableToken(
      headerNumber, blockProof, block.number, block.timestamp, reference, 1, /* logIndex */ exitTx, mintTx, alice)

    // expect(await childContracts.rootERC721.exists(tokenId)).to.be.true
    expect((await childContracts.rootERC721.ownerOf(tokenId)).toLowerCase()).to.equal(contracts.depositManager.address.toLowerCase())
    const logs = logDecoder.decodeLogs(startExitTx.receipt.rawLogs)
    // console.log(startExitTx, logs)
    const log = logs[1]
    log.event.should.equal('ExitStarted')
    expect(log.args).to.include({
      exitor: alice,
      token: childContracts.rootERC721.address
    })
    utils.assertBigNumberEquality(log.args.amount, tokenId)
  })


  // describe('ERC721PlasmaMintable', async function() {
  //   beforeEach(async function() {
  //     predicate = await deployer.deployErc721Predicate()
  //     const { rootERC721, childErc721 } = await deployer.deployChildErc721Mintable()
  //     // add ERC721Predicate as a minter
  //     await rootERC721.addMinter(predicate.address)
  //     childContracts.rootERC721 = rootERC721
  //     childContracts.childErc721 = childErc721
  //     tokenId = '0x' + crypto.randomBytes(32).toString('hex')
  //   })
  // })
})

function startExitWithBurntMintableToken(input, mintTx, from) {
  return predicate.startExitWithMintedAndBurntTokens(
    ethUtils.bufferToHex(ethUtils.rlp.encode(utils.buildReferenceTxPayload(input))),
    ethUtils.bufferToHex(mintTx),
    { from }
  )
}

function startMoreVpExitWithMintableToken(
  headerNumber, blockProof, blockNumber, blockTimestamp, reference, logIndex, exitTx, mintTx, from) {
  return predicate.startExitAndMint(
    ethUtils.bufferToHex(
      ethUtils.rlp.encode([
        headerNumber,
        ethUtils.bufferToHex(Buffer.concat(blockProof)),
        blockNumber,
        blockTimestamp,
        ethUtils.bufferToHex(reference.transactionsRoot),
        ethUtils.bufferToHex(reference.receiptsRoot),
        ethUtils.bufferToHex(reference.receipt),
        ethUtils.bufferToHex(ethUtils.rlp.encode(reference.receiptParentNodes)),
        ethUtils.bufferToHex(ethUtils.rlp.encode(reference.path)), // branch mask,
        logIndex
      ])
    ),
    ethUtils.bufferToHex(exitTx),
    ethUtils.bufferToHex(mintTx),
    { from, value: web3.utils.toWei('.1', 'ether') }
  )
}
