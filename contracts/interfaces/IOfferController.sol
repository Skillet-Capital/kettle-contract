// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { MarketOffer, LoanOffer, BorrowOffer } from "../Structs.sol";

interface IOfferController {

    event LoanOfferTaken(
        uint256 indexed lienId,
        address indexed taker,
        bytes32 indexed hash,
        uint256 amount,
        address collection,
        uint256 tokenId,
        LoanOffer offer
    );

    event BorrowOfferTaken(
        uint256 indexed lienId,
        address indexed taker,
        bytes32 indexed hash,
        address collection,
        uint256 tokenId,
        BorrowOffer offer
    );

    event MarketOfferTaken(
        address indexed taker,
        bytes32 indexed hash,
        address collection,
        uint256 tokenId,
        MarketOffer offer
    );

    event OfferCancelled(
        address indexed user,
        uint256 indexed salt
    );

    event NonceIncremented(
        address indexed user,
        uint256 indexed nonce
    );
}
