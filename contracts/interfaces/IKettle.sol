// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

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
        uint256 period,
        uint256 tenor,
        uint256 startTime,
        uint256 defaultPeriod,
        uint256 defaultRate,
        uint256 fee
    );

    event Payment(
        uint256 indexed lienId,
        uint256 amount,
        uint256 amountOwed
    );

    event Repay(
        uint256 indexed lienId,
        uint256 amountOwed
    );

    event Refinance(
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
        uint256 period,
        uint256 tenor,
        uint256 startTime,
        uint256 defaultPeriod,
        uint256 defaultRate,
        uint256 fee
    );
}
