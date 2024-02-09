// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import { LoanOffer, Lien, LienState, LienStatus } from "./Structs.sol";
import { InvalidLien, LienDefaulted } from "./Errors.sol";

import { IKettle } from "./interfaces/IKettle.sol";
import { Helpers } from "./Helpers.sol";
import { Transfer } from "./Transfer.sol";

contract Kettle is IKettle {

    uint256 private _nextLienId;
    mapping(uint256 => bytes32) public liens;

    function amountOwed(Lien memory lien) public view returns (uint256) {
        return Helpers.amountOwed(lien);
    }

    function lienStatus(Lien memory lien) public view returns (LienStatus) {
        if (lien.state.lastPayment + lien.period + lien.defaultPeriod < block.timestamp) {
            return LienStatus.DEFAULTED;
        } else if (lien.state.lastPayment + lien.period < block.timestamp) {
            return LienStatus.DELINQUENT;
        } else {
            return LienStatus.CURRENT;
        }
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
        // set custom borrower
        if (borrower == address(0)) {
            borrower = msg.sender;
        }

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
            borrower,
            offer.currency,
            offer.collection,
            tokenId,
            offer.size,
            amount,
            offer.rate,
            offer.period,
            offer.tenor,
            block.timestamp,
            offer.defaultPeriod,
            offer.defaultRate,
            LienState({
                lastPayment: block.timestamp,
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
            lien.collection,
            address(lien.currency),
            lien.tokenId,
            lien.size,
            lien.principal,
            lien.rate,
            lien.period,
            lien.tenor,
            lien.startTime,
            lien.defaultPeriod,
            lien.defaultRate
        );
    }

    function payment(
        uint256 lienId,
        uint256 amount,
        Lien calldata lien
    ) public validateLien(lien, lienId) lienIsCurrent(lien) {
        uint256 _amount = _payment(lien, lienId, amount, false);

        // transfer amount from borrower to lender
        IERC20(lien.currency).transferFrom(msg.sender, lien.lender, _amount);
    }

    function interestPayment(
        uint256 lienId,
        Lien calldata lien
    ) public validateLien(lien, lienId) lienIsCurrent(lien) {
        uint256 _amount = _payment(lien, lienId, 0, true);

        // transfer amount from borrower to lender
        IERC20(lien.currency).transferFrom(msg.sender, lien.lender, _amount);
    }

    function _payment(
        Lien calldata lien,
        uint256 lienId,
        uint256 amount,
        bool allInterest
    ) internal returns (uint256 _amount) {
        uint256 amountOwed = Helpers.amountOwed(lien);

        // amount to pay is min of amount and amount owed
        if (allInterest) {
            _amount = amountOwed - lien.principal;
        } else {
            // amount to pay is min of amount and amount owed
            _amount = Math.min(amount, amountOwed);
        }

        // update lien state
        Lien memory newLien = Lien(
            lien.lender,
            lien.borrower,
            lien.currency,
            lien.collection,
            lien.tokenId,
            lien.size,
            lien.principal,
            lien.rate,
            lien.period,
            lien.tenor,
            lien.startTime,
            lien.defaultPeriod,
            lien.defaultRate,
            LienState({
                lastPayment: block.timestamp,
                amountOwed: amountOwed - _amount
            })
        );

        unchecked {
            liens[lienId] = keccak256(abi.encode(newLien));
        }

        emit Payment(lienId, _amount, amountOwed - _amount);
    }

    function repay(
        uint256 lienId,
        Lien calldata lien
    ) public validateLien(lien, lienId) lienIsCurrent(lien) {
        uint256 amountOwed = _repay(lien, lienId);

        // transfer collateral back to borrower
        Transfer.transferToken(lien.collection, address(this), lien.borrower, lien.tokenId, lien.size);

        // transfer amount owed from borrower to lender
        IERC20(lien.currency).transferFrom(msg.sender, lien.lender, amountOwed);
    }

    function _repay(
        Lien calldata lien,
        uint256 lienId
    ) internal returns (uint256 amountOwed) {
        amountOwed = Helpers.amountOwed(lien);

        delete liens[lienId];

        emit Repay(lienId, amountOwed);
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
        return (lien.state.lastPayment + lien.period + lien.defaultPeriod) < block.timestamp;
    }
}
