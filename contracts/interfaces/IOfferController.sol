// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IOfferController {

    event LoanOfferTaken(
        uint256 indexed lienId,
        address indexed taker,
        bytes32 indexed hash
    );

    event BorrowOfferTaken(
        uint256 indexed lienId,
        address indexed taker,
        bytes32 indexed hash
    );

    event MarketOfferTaken(
        address indexed taker,
        bytes32 indexed hash
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
