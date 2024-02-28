import { ethers } from "hardhat";

import { MerkleTree } from 'merkletreejs';
import { BigNumber, BigNumberish } from "@ethersproject/bignumber";
import { keccak256 } from '@ethersproject/keccak256';

export function randomBytes() {
  return ethers.hexlify(ethers.randomBytes(32));
}

export function hashIdentifier(identifier: bigint | number) {
  return keccak256(
    Buffer.from(
      BigNumber.from(identifier).toHexString().slice(2).padStart(64, "0"),
      "hex"
    )
  );
}

export function generateMerkleRootForCollection(tokenIds: bigint[] | number[]): string {
  const tree = new MerkleTree(
    tokenIds.map(hashIdentifier), keccak256, {
      sort: true
    }
  );

  return tree.getHexRoot();
}

export function generateMerkleProofForToken(tokenIds: bigint[] | number[], token: bigint | number): string[] {
  const tree = new MerkleTree(
    tokenIds.map(hashIdentifier), keccak256, {
      sort: true
    }
  );

  const identifier = hashIdentifier(token);
  return tree.getHexProof(identifier);
}