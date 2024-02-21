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
        uint256 pastInterest,
        uint256 pastFee,
        uint256 currentInterest,
        uint256 currentFee,
        uint256 principal,
        uint256 amountOwed,
        uint256 paidThrough
    );

    event Repay(
        uint256 indexed lienId,
        uint256 pastInterest,
        uint256 pastFee,
        uint256 currentInterest,
        uint256 currentFee,
        uint256 principal,
        uint256 amountOwed
    );

    event Refinance(
        uint256 indexed oldLienId,
        uint256 indexed newLienId,
        uint256 pastInterest,
        uint256 pastFee,
        uint256 currentInterest,
        uint256 currentFee,
        uint256 principal,
        uint256 amountOwed,
        uint256 amount
    );

    event Claim(
        uint256 indexed lienId,
        address indexed lender
    );
}
