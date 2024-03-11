// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IKettle {

    event Borrow(
        uint256 indexed lienId,
        address indexed lender,
        address indexed borrower,
        address recipient,
        address collection,
        address currency,
        uint8 itemType,
        uint256 tokenId,
        uint256 size,
        uint256 principal,
        uint256 fee,
        uint256 rate,
        uint256 defaultRate,
        uint256 duration,
        uint256 gracePeriod,
        uint256 startTime
    );

    event Refinance(
        uint256 indexed oldLienId,
        uint256 indexed newLienId,
        uint256 amount,
        uint256 debt,
        uint256 principal,
        uint256 interest,
        uint256 fee
    );

    event Repay(
        uint256 indexed lienId,
        uint256 debt,
        uint256 principal,
        uint256 interest,
        uint256 fee
    );

    event Claim(
        uint256 indexed lienId,
        address indexed lender
    );

    event MarketOrder(
        address indexed buyer,
        address indexed seller,
        address currency,
        address collection,
        uint256 tokenId,
        uint256 size,
        uint256 amount,
        uint256 netAmount
    );

    event BuyWithLoan(
        uint256 indexed lienId,
        address indexed buyer,
        address indexed seller,
        address currency,
        address collection,
        uint256 tokenId,
        uint256 size,
        uint256 amount,
        uint256 netAmount,
        uint256 borrowAmount
    );

    event BuyInLien(
        uint256 indexed lienId,
        address indexed buyer,
        address indexed seller,
        address currency,
        address collection,
        uint256 tokenId,
        uint256 size,
        uint256 amount,
        uint256 netAmount,
        uint256 debt,
        uint256 principal,
        uint256 interest,
        uint256 fee
    );

    event BuyInLienWithLoan(
        uint256 indexed oldLienId,
        uint256 indexed newLienId,
        address buyer,
        address seller,
        address currency,
        address collection,
        uint256 tokenId,
        uint256 size,
        uint256 amount,
        uint256 netAmount,
        uint256 borrowAmount,
        uint256 debt,
        uint256 principal,
        uint256 interest,
        uint256 fee
    );

    event SellWithLoan(
        uint256 indexed lienId,
        address indexed buyer,
        address indexed seller,
        address currency,
        address collection,
        uint256 tokenId,
        uint256 size,
        uint256 amount,
        uint256 netAmount,
        uint256 borrowAmount
    );

    event SellInLien(
        uint256 indexed lienId,
        address indexed buyer,
        address indexed seller,
        address currency,
        address collection,
        uint256 tokenId,
        uint256 size,
        uint256 amount,
        uint256 netAmount,
        uint256 balance,
        uint256 principal,
        uint256 interest,
        uint256 fee
    );

    event SellInLienWithLoan(
        uint256 indexed oldLienId,
        uint256 indexed newLienId,
        address buyer,
        address seller,
        address currency,
        address collection,
        uint256 tokenId,
        uint256 size,
        uint256 amount,
        uint256 netAmount,
        uint256 borrowAmount,
        uint256 debt,
        uint256 principal,
        uint256 interest,
        uint256 fee
    );
}
