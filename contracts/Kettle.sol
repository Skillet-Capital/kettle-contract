// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { LoanOffer, Lien, LienState, LienStatus, InterestModel, RefinanceTranche } from "./Structs.sol";
import { InvalidLien, LienDefaulted, Unauthorized } from "./Errors.sol";

import { IKettle } from "./interfaces/IKettle.sol";
import { FixedInterest } from "./models/FixedInterest.sol";
import { Transfer } from "./Transfer.sol";
import { Helpers } from "./Helpers.sol";

import "hardhat/console.sol";

contract Kettle is IKettle {

    uint256 private _nextLienId;
    mapping(uint256 => bytes32) public liens;

    function amountOwed(Lien memory lien) public view returns (
        uint256 amountOwed,
        uint256 principal,
        uint256 pastInterest,
        uint256 pastFee,
        uint256 currentInterest,
        uint256 currentFee
    ) {
        (
            amountOwed,
            pastInterest, 
            pastFee, 
            currentInterest,
            currentFee
        ) = FixedInterest.computeAmountOwed(lien);

        principal = lien.state.amountOwed;
    }

    function nextPaymentDate(Lien memory lien) public view returns (uint256 date) {
        return FixedInterest.computeNextPaymentDate(lien);
    }

    function lienStatus(Lien memory lien) public view returns (uint8) {
        return FixedInterest.computeLienStatus(lien);
    }

    /*//////////////////////////////////////////////////
                    BORROW FLOWS
    //////////////////////////////////////////////////*/

    function borrow(
        LoanOffer calldata offer,
        uint256 amount,
        uint256 tokenId,
        address borrower,
        bytes32[] calldata proof
    ) public returns (uint256 lienId){
        if (borrower == address(0)) borrower = msg.sender;

        lienId = _borrow(offer, amount, tokenId, borrower);

        // lock collateral
        Transfer.transferToken(offer.collection, msg.sender, address(this), tokenId, offer.size);

        // transfer loan to borrower
        IERC20(offer.currency).transferFrom(offer.lender, borrower, amount);
    }

    function _borrow(
        LoanOffer calldata offer,
        uint256 amount,
        uint256 tokenId,
        address borrower
    ) public returns (uint256 lienId) {

        Lien memory lien = Lien(
            offer.lender,
            offer.recipient,
            borrower,
            offer.currency,
            offer.collection,
            tokenId,
            offer.size,
            amount,
            offer.rate,
            offer.fee,
            offer.period,
            offer.gracePeriod,
            offer.tenor,
            block.timestamp,
            LienState({
                paidThrough: block.timestamp,
                amountOwed: amount
            })
        );

        unchecked {
            liens[lienId = _nextLienId++] = keccak256(abi.encode(lien));
        }

        emit Borrow(
            lienId,
            lien.lender,
            lien.borrower,
            lien.recipient,
            lien.collection,
            lien.currency,
            lien.tokenId,
            lien.size,
            lien.principal,
            lien.rate,
            lien.fee,
            lien.period,
            lien.gracePeriod,
            lien.tenor,
            lien.startTime
        );
    }

    function principalPayment(
        uint256 lienId,
        uint256 _principal,
        Lien calldata lien
    ) public validateLien(lien, lienId) lienIsCurrent(lien) {
       (
            uint256 pastInterest, 
            uint256 pastFee, 
            uint256 currentInterest, 
            uint256 currentFee,
            uint256 principal
        ) = _payment(lien, lienId, _principal, false);

        // transfer amount from borrower to lender
        IERC20(lien.currency).transferFrom(msg.sender, lien.lender, pastInterest + currentInterest + principal);

        // transfer fee interest from borrower to fee receiver
        IERC20(lien.currency).transferFrom(msg.sender, lien.recipient, pastFee + currentFee);
    }

    function interestPayment(
        uint256 lienId,
        Lien calldata lien
    ) public validateLien(lien, lienId) lienIsCurrent(lien) {
        (
            uint256 pastInterest, 
            uint256 pastFee, 
            uint256 currentInterest,
            uint256 currentFee,
        ) = _payment(lien, lienId, 0, false);

        // transfer lender interest from borrower to lender
        IERC20(lien.currency).transferFrom(msg.sender, lien.lender, pastInterest + currentInterest);

        // transfer fee interest from borrower to fee receiver
        IERC20(lien.currency).transferFrom(msg.sender, lien.recipient, pastFee + currentFee);
    }

    function curePayment(
        uint256 lienId,
        Lien calldata lien
    ) public validateLien(lien, lienId) lienIsCurrent(lien) {
        (
            uint256 pastInterest, 
            uint256 pastFee,
            ,,
        ) = _payment(lien, lienId, 0, true);

        // transfer lender interest from borrower to lender
        IERC20(lien.currency).transferFrom(msg.sender, lien.lender, pastInterest);

        // transfer fee interest from borrower to fee receiver
        IERC20(lien.currency).transferFrom(msg.sender, lien.recipient, pastFee);
    }

    function _payment(
        Lien calldata lien,
        uint256 lienId,
        uint256 _principal,
        bool cureOnly
    ) internal returns (
        uint256 pastInterest, 
        uint256 pastFee, 
        uint256 currentInterest,
        uint256 currentFee,
        uint256 principal
    ) {
        (
            ,
            pastInterest, 
            pastFee, 
            currentInterest, 
            currentFee
        ) = FixedInterest.computeAmountOwed(lien);

        // calculate minimum amount to be paid
        uint256 minimumPayment = pastInterest + pastFee;
        if (!cureOnly) {
            minimumPayment += currentInterest + currentFee;
        }

        uint256 principal = Math.min(_principal, lien.state.amountOwed);
        uint256 amountOwed = lien.state.amountOwed - principal;

        // update lien state
        Lien memory newLien = Lien(
            lien.lender,
            lien.recipient,
            lien.borrower,
            lien.currency,
            lien.collection,
            lien.tokenId,
            lien.size,
            lien.principal,
            lien.rate,
            lien.fee,
            lien.period,
            lien.gracePeriod,
            lien.tenor,
            lien.startTime,
            LienState({
                paidThrough: FixedInterest.computePaidThrough(lien, cureOnly),
                amountOwed: amountOwed
            })
        );

        liens[lienId] = keccak256(abi.encode(newLien));

        emit Payment(
            lienId, 
            pastInterest,
            pastFee,
            cureOnly ? 0 : currentInterest,
            cureOnly ? 0 : currentFee,
            principal, 
            newLien.state.amountOwed,
            newLien.state.paidThrough
        );
    }

    function refinance(
        uint256 oldLienId,
        uint256 amount,
        Lien calldata lien,
        LoanOffer calldata offer,
        bytes32[] calldata proof
    ) public validateLien(lien, oldLienId) lienIsCurrent(lien) returns (uint256 newLienId) {
        if (msg.sender != lien.borrower) {
            revert Unauthorized();
        }

        newLienId = _refinance(oldLienId, amount, lien, offer);

        _distributePayments(oldLienId, newLienId, amount, lien, offer);
    }

    function _refinance(
        uint256 oldLienId,
        uint256 amount,
        Lien calldata lien,
        LoanOffer calldata offer
    ) internal returns (uint256 newLienId) {
        delete liens[oldLienId];

        Lien memory newLien = Lien(
            offer.lender,
            offer.recipient,
            msg.sender,
            offer.currency,
            offer.collection,
            lien.tokenId,
            offer.size,
            amount,
            offer.rate,
            offer.fee,
            offer.period,
            offer.gracePeriod,
            offer.tenor,
            block.timestamp,
            LienState({
                paidThrough: block.timestamp,
                amountOwed: amount
            })
        );

        unchecked {
            liens[newLienId = _nextLienId++] = keccak256(abi.encode(newLien));
        }

        emit Borrow(
            newLienId,
            newLien.lender,
            newLien.borrower,
            newLien.recipient,
            newLien.collection,
            newLien.currency,
            newLien.tokenId,
            newLien.size,
            newLien.principal,
            newLien.rate,
            newLien.fee,
            newLien.period,
            newLien.gracePeriod,
            newLien.tenor,
            newLien.startTime
        );
    }

    function _distributePayments(
        uint256 oldLienId,
        uint256 newLienId,
        uint256 amount,
        Lien calldata lien,
        LoanOffer calldata offer
    ) internal {
        (
            uint256 amountOwed,
            uint256 pastInterest, 
            uint256 pastFee, 
            uint256 currentInterest, 
            uint256 currentFee
        ) = FixedInterest.computeAmountOwed(lien);

        uint256 principal = lien.state.amountOwed;
        uint256 interest = pastInterest + currentInterest;
        uint256 fee = pastFee + currentFee;

        if (amount < amountOwed) {

            RefinanceTranche[3] memory tranches = Helpers.createTranches(
                principal, 
                lien.lender,
                pastInterest + currentInterest, 
                lien.lender, 
                pastFee + currentFee, 
                lien.recipient
            );

            // +-----------------------------------------------------------+
            // |                                              amount       |
            // |-------------------------|-----------------|----↓----------|
            // |        tranches[0]      |   tranches[1]   |   tranches[2] |
            // +-----------------------------------------------------------+

            if (amount > tranches[0].amount + tranches[1].amount) {
                Transfer.transferCurrency(lien.currency, offer.lender, tranches[0].recipient, tranches[0].amount);
                Transfer.transferCurrency(lien.currency, offer.lender, tranches[1].recipient, tranches[1].amount);

                uint256 lenderTranchePayment = amount - (tranches[0].amount + tranches[1].amount);
                uint256 borrowerTranchePayment = tranches[2].amount - lenderTranchePayment;

                Transfer.transferCurrency(lien.currency, offer.lender, tranches[2].recipient, lenderTranchePayment);
                Transfer.transferCurrency(lien.currency, msg.sender, tranches[2].recipient, borrowerTranchePayment);
            }

            // +-----------------------------------------------------------+
            // |                             amount                        |
            // |-------------------------|-----↓-----------|---------------|
            // |        tranches[0]      |   tranches[1]   |   tranches[2] |
            // +-----------------------------------------------------------+

            else if (amount > tranches[0].amount) {
                Transfer.transferCurrency(lien.currency, offer.lender, tranches[0].recipient, tranches[0].amount);

                uint256 lenderTranchePayment = amount - tranches[0].amount;
                uint256 borrowerTranchePayment = tranches[1].amount - lenderTranchePayment;

                Transfer.transferCurrency(lien.currency, offer.lender, tranches[1].recipient, lenderTranchePayment);
                Transfer.transferCurrency(lien.currency, msg.sender, tranches[1].recipient, borrowerTranchePayment);

                Transfer.transferCurrency(lien.currency, msg.sender, tranches[2].recipient, tranches[2].amount);
            }

            // +-----------------------------------------------------------+
            // |       amount                                              |
            // |---------↓---------------|-----------------|---------------|
            // |        tranches[0]      |   tranches[1]   |   tranches[2] |
            // +-----------------------------------------------------------+

            else {
                uint256 lenderTranchePayment = amount;
                uint256 borrowerTranchePayment = tranches[0].amount - lenderTranchePayment;

                Transfer.transferCurrency(lien.currency, offer.lender, tranches[0].recipient, lenderTranchePayment);
                Transfer.transferCurrency(lien.currency, msg.sender, tranches[0].recipient, borrowerTranchePayment);

                Transfer.transferCurrency(lien.currency, msg.sender, tranches[1].recipient, tranches[1].amount);
                Transfer.transferCurrency(lien.currency, msg.sender, tranches[2].recipient, tranches[2].amount);
            }

        } else {
            uint256 netPrincipalReceived = amount - amountOwed;
            Transfer.transferCurrency(lien.currency, offer.lender, msg.sender, netPrincipalReceived);
            Transfer.transferCurrency(lien.currency, offer.lender, lien.lender, interest + principal);
            Transfer.transferCurrency(lien.currency, offer.lender, lien.recipient, fee);
        }

        emit Refinance(
            oldLienId,
            newLienId,
            pastInterest,
            pastFee,
            currentInterest,
            currentFee,
            principal,
            amountOwed,
            amount
        );
    }

    function repay(
        uint256 lienId,
        Lien calldata lien
    ) public validateLien(lien, lienId) lienIsCurrent(lien) {
        (
            uint256 pastInterest,
            uint256 pastFee,
            uint256 currentInterest,
            uint256 currentFee
        ) = _repay(lien, lienId);

        // transfer collateral back to borrower
        Transfer.transferToken(lien.collection, address(this), lien.borrower, lien.tokenId, lien.size);

        // transfer amount owed from borrower to lender
        IERC20(lien.currency).transferFrom(msg.sender, lien.lender, lien.state.amountOwed + pastInterest + currentInterest + pastFee + currentFee);

        // transfer fee interest from borrower to fee receiver
        IERC20(lien.currency).transferFrom(msg.sender, lien.recipient, pastFee + currentFee);
    }

    function _repay(
        Lien calldata lien,
        uint256 lienId
    ) internal returns (
        uint256 pastInterest,
        uint256 pastFee,
        uint256 currentInterest,
        uint256 currentFee
    ) {
        uint256 amountOwed;
        (
            amountOwed,
            pastInterest, 
            pastFee, 
            currentInterest, 
            currentFee
        ) = FixedInterest.computeAmountOwed(lien);

        delete liens[lienId];

        emit Repay(
            lienId, 
            pastInterest,
            pastFee,
            currentInterest,
            currentFee,
            lien.state.amountOwed,
            amountOwed
        );
    }

    modifier validateLien(Lien calldata lien, uint256 lienId) {
        if (!_validateLien(lien, lienId)) {
            revert InvalidLien();
        }

        _;
    }

    modifier lienIsCurrent(Lien calldata lien) {
        if (_lienIsDefaulted(lien)) {
            revert LienDefaulted();
        }

        _;
    }

    function _validateLien(
        Lien calldata lien,
        uint256 lienId
    ) internal view returns (bool) {
        return liens[lienId] == keccak256(abi.encode(lien));
    }

    function _lienIsDefaulted(
        Lien calldata lien
    ) internal view returns (bool) {
        return (lien.state.paidThrough + lien.period + lien.gracePeriod) < block.timestamp;
    }
}
