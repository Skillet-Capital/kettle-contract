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
        uint256 tokenId,
        uint256 size,
        uint256 principal,
        uint256 rate,
        uint256 fee,
        uint256 period,
        uint256 gracePeriod,
        uint256 tenor,
        uint256 startTime
    );

    event Payment(
        uint256 indexed lienId,
        uint256 principal,
        uint256 pastInterest,
        uint256 pastFee,
        uint256 currentInterest,
        uint256 currentFee,
        uint256 newPrincipal,
        uint256 paidThrough
    );

    event Repay(
        uint256 indexed lienId,
        uint256 balance,
        uint256 principal,
        uint256 pastInterest,
        uint256 pastFee,
        uint256 currentInterest,
        uint256 currentFee
    );

    event Refinance(
        uint256 indexed oldLienId,
        uint256 indexed newLienId,
        uint256 amount,
        uint256 balance,
        uint256 principal,
        uint256 pastInterest,
        uint256 pastFee,
        uint256 currentInterest,
        uint256 currentFee
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
        uint256 amount
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
        uint256 balance,
        uint256 principal,
        uint256 pastInterest,
        uint256 pastFee,
        uint256 currentInterest,
        uint256 currentFee
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
        uint256 borrowAmount,
        uint256 balance,
        uint256 principal,
        uint256 pastInterest,
        uint256 pastFee,
        uint256 currentInterest,
        uint256 currentFee
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
        uint256 balance,
        uint256 principal,
        uint256 pastInterest,
        uint256 pastFee,
        uint256 currentInterest,
        uint256 currentFee
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
        uint256 borrowAmount,
        uint256 balance,
        uint256 principal,
        uint256 pastInterest,
        uint256 pastFee,
        uint256 currentInterest,
        uint256 currentFee
    );
}
